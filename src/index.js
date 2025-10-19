import api, { route, storage } from '@forge/api';

/**
 * Storage keys for chat history tracking
 */
const CHAT_HISTORY_KEY = 'chat-history';
const CURRENT_CHAT_ID_KEY = 'current-chat-id';

/**
 * Reset chat history - clears all created items tracking
 */
export async function resetChatHistory() {
  try {
    await storage.set(CHAT_HISTORY_KEY, {
      createdEpics: [],
      createdStories: [],
      createdSubtasks: []
    });

    // Generate new chat ID
    const newChatId = Date.now().toString();
    await storage.set(CURRENT_CHAT_ID_KEY, newChatId);

    return {
      success: true,
      message: 'Chat history reset successfully',
      chatId: newChatId
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to reset chat history: ${error.message}`
    };
  }
}

/**
 * Get chat history from storage
 */
async function getChatHistory() {
  const history = await storage.get(CHAT_HISTORY_KEY);
  if (!history) {
    return {
      createdEpics: [],
      createdStories: [],
      createdSubtasks: []
    };
  }
  return history;
}

/**
 * Save chat history to storage
 */
async function saveChatHistory(history) {
  await storage.set(CHAT_HISTORY_KEY, history);
}

/**
 * Check if item already exists in chat history
 */
function isDuplicate(itemSummary, createdItems) {
  // Normalize summary for comparison (lowercase, trim whitespace)
  const normalizedSummary = itemSummary.toLowerCase().trim();
  return createdItems.some(item =>
    item.summary.toLowerCase().trim() === normalizedSummary
  );
}

/**
 * Rovo Action: Creates a complete Jira plan automatically from a goal
 * This is called directly by the Rovo agent when user provides a goal
 */
export async function createJiraPlanAction(payload) {
  try {
    const { projectKey, goal, resetHistory } = payload;

    // Reset history if requested
    if (resetHistory) {
      await resetChatHistory();
    }


    // Validate inputs
    if (!projectKey || !goal) {
      return {
        success: false,
        message: 'Missing required fields. Please provide both a project key and a goal description.'
      };
    }

    // Parse the goal into a structured plan
    const plan = parseGoalIntoPlan(goal, {});

    // Create all the Jira issues automatically
    const createdIssues = await createJiraIssues(projectKey, plan, goal, {});

    // Check if any issues were created
    if (createdIssues.epics.length === 0 && createdIssues.stories.length === 0 && createdIssues.subtasks.length === 0) {
      return {
        success: false,
        message: 'No issues were created. This might be because all items already exist in your chat history. If you want to start fresh, you can reset the chat history.'
      };
    }

    // Build detailed summary with bullet points for Rovo chat
    let detailedSummary = `## Successfully Created Jira Plan for ${projectKey}\n\n`;
    detailedSummary += `**Summary:**\n`;
    detailedSummary += `- ${createdIssues.epics.length} Epics\n`;
    detailedSummary += `- ${createdIssues.stories.length} Stories\n`;
    detailedSummary += `- ${createdIssues.subtasks.length} Subtasks\n\n`;

    if (createdIssues.epics.length > 0) {
      detailedSummary += `**Epics Created:**\n`;
      createdIssues.epics.forEach(epic => {
        detailedSummary += `- ${epic.key}: ${epic.summary}\n`;
      });
    }

    // Return summary for the Rovo agent to share with the user
    return {
      success: true,
      message: detailedSummary,
      summary: {
        projectKey: projectKey,
        epicCount: createdIssues.epics.length,
        storyCount: createdIssues.stories.length,
        subtaskCount: createdIssues.subtasks.length,
        epics: createdIssues.epics.map(e => ({
          key: e.key,
          summary: e.summary
        })),
        firstEpicKey: createdIssues.epics.length > 0 ? createdIssues.epics[0].key : null
      }
    };

  } catch (error) {
    return {
      success: false,
      message: `Failed to create plan: ${error.message}`,
      error: error.message
    };
  }
}

/**
 * Webtrigger handler that receives goals from Rovo and generates a Jira plan.
 * Expected payload: { projectKey, goal, context }
 */
export async function planGenerator(request) {
  try {
    // Parse the incoming request body from Rovo
    const payload = request.body;
    const { projectKey, goal, context } = payload;


    // Validate required fields
    if (!projectKey || !goal) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Missing required fields: projectKey and goal are required'
        })
      };
    }

    // Parse the goal and generate plan structure
    const plan = parseGoalIntoPlan(goal, context);

    // Create the Jira issues based on the plan
    const createdIssues = await createJiraIssues(projectKey, plan, goal, context);

    // Return success response with created issue details
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Plan created successfully',
        plan: createdIssues
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Failed to generate plan',
        details: error.message
      })
    };
  }
}

/**
 * Parses a goal description into a structured plan with epics, stories, and subtasks.
 * Dynamically analyzes the goal to intelligently break it down into manageable components.
 *
 * @param {string} goal - The goal description from the user
 * @param {object} context - Additional context (labels, components, owners, etc.)
 * @returns {object} Structured plan with epics, stories, and subtasks
 */
function parseGoalIntoPlan(goal, context = {}) {
  const plan = {
    epics: []
  };

  // Analyze goal complexity and structure
  const analysis = analyzeGoal(goal);

  // Generate epics based on analysis
  analysis.workAreas.forEach(area => {
    const epic = generateEpicForWorkArea(area, goal, analysis, context);
    plan.epics.push(epic);
  });

  return plan;
}

/**
 * Analyzes a goal to understand its scope, complexity, and required work areas
 * Complexity mapping based on manifest.yml prompt:
 * - SIMPLE: 1-2 epics (e.g., "Add a login button")
 * - MEDIUM: 2-4 epics (e.g., "Build a user authentication system")
 * - COMPLEX: 4-8 epics (e.g., "Build a mobile app", "Create an e-commerce platform")
 */
function analyzeGoal(goal) {
  const words = goal.split(/\s+/).length;
  const sentences = goal.split(/[.!?]+/).filter(s => s.trim()).length;

  // Detect work areas dynamically
  const workAreas = [];

  // Core technical areas
  if (/frontend|ui|interface|design|user|ux|screen|page|component|view|display/i.test(goal)) {
    workAreas.push({ type: 'frontend', keywords: extractKeywords(goal, /frontend|ui|interface|design|user|ux|screen|page|component|view|display/i) });
  }
  if (/backend|api|server|database|service|endpoint|integration|logic|process/i.test(goal)) {
    workAreas.push({ type: 'backend', keywords: extractKeywords(goal, /backend|api|server|database|service|endpoint|integration|logic|process/i) });
  }
  if (/auth|login|security|permission|access|sign[- ]?in|sign[- ]?up|password|session/i.test(goal)) {
    workAreas.push({ type: 'auth', keywords: extractKeywords(goal, /auth|login|security|permission|access|sign[- ]?in|sign[- ]?up|password|session/i) });
  }
  if (/test|qa|quality|validation|verification|coverage/i.test(goal)) {
    workAreas.push({ type: 'testing', keywords: extractKeywords(goal, /test|qa|quality|validation|verification|coverage/i) });
  }
  if (/deploy|release|ci\/cd|pipeline|build|production|infrastructure/i.test(goal)) {
    workAreas.push({ type: 'deployment', keywords: extractKeywords(goal, /deploy|release|ci\/cd|pipeline|build|production|infrastructure/i) });
  }
  if (/data|migration|import|export|sync|transform|etl/i.test(goal)) {
    workAreas.push({ type: 'data', keywords: extractKeywords(goal, /data|migration|import|export|sync|transform|etl/i) });
  }
  if (/mobile|ios|android|app|native|react native|flutter/i.test(goal)) {
    workAreas.push({ type: 'mobile', keywords: extractKeywords(goal, /mobile|ios|android|app|native|react native|flutter/i) });
  }
  if (/document|doc|readme|guide|instruction|manual/i.test(goal)) {
    workAreas.push({ type: 'documentation', keywords: extractKeywords(goal, /document|doc|readme|guide|instruction|manual/i) });
  }

  // If no specific areas detected, analyze as general implementation
  if (workAreas.length === 0) {
    workAreas.push({ type: 'implementation', keywords: [] });
  }

  // Determine complexity based on multiple factors
  // Align with manifest.yml definitions:
  // - SIMPLE: 1 epic
  // - MEDIUM: 2 epics
  // - COMPLEX: 6 epics
  let complexity = 'low';

  // Factor 1: Number of work areas detected (primary indicator)
  if (workAreas.length >= 4) {
    complexity = 'high'; // Will generate 6 epics
    // For high complexity, limit to 6 work areas
    if (workAreas.length > 6) {
      workAreas.splice(6);
    }
  } else if (workAreas.length >= 2) {
    complexity = 'medium'; // Will generate 2 epics
    // For medium complexity, limit to 2 work areas
    if (workAreas.length > 2) {
      workAreas.splice(2);
    }
  } else {
    complexity = 'low'; // Will generate 1 epic
    // For low complexity, limit to 1 work area
    if (workAreas.length > 1) {
      workAreas.splice(1);
    }
  }

  // Factor 2: Word count indicates detail level
  if (words > 100) {
    complexity = 'high';
  } else if (words > 30 && complexity === 'low') {
    complexity = 'medium';
  }

  // Factor 3: Certain work areas inherently indicate higher complexity
  const highComplexityAreas = ['mobile', 'backend', 'auth', 'deployment', 'data'];
  const hasHighComplexityArea = workAreas.some(area => highComplexityAreas.includes(area.type));
  if (hasHighComplexityArea && complexity === 'low') {
    complexity = 'medium';
  }

  // Factor 4: Multiple sentences suggest more detailed requirements
  if (sentences >= 3 && complexity === 'low') {
    complexity = 'medium';
  }
  if (sentences >= 5) {
    complexity = 'high';
  }

  return {
    workAreas,
    complexity,
    wordCount: words,
    sentenceCount: sentences
  };
}

/**
 * Extract relevant keywords from goal text based on pattern
 */
function extractKeywords(text, pattern) {
  const matches = text.match(pattern);
  return matches ? [...new Set(matches.map(m => m.toLowerCase()))] : [];
}

/**
 * Generate an epic for a specific work area based on goal analysis
 */
function generateEpicForWorkArea(workArea, goal, analysis, context) {
  const { type, keywords } = workArea;

  // Generate epic name and description
  const epicName = capitalizeWorkArea(type);
  const epicSummary = `${epicName}: ${truncateText(goal, 60)}`;
  const epicDescription = `${epicName} work for:\n\n${goal}\n\nDetected focus areas: ${keywords.join(', ') || 'general implementation'}`;

  // Generate stories dynamically based on the work area and goal
  const stories = generateStoriesForWorkArea(type, goal, keywords, analysis);

  // Calculate difficulty and time for the epic
  const epicDifficulty = calculateDifficulty(epicName, goal, stories.length);
  const epicEstimatedTime = calculateEstimatedTime(epicDifficulty, 'epic', epicName, goal, stories.length);

  return {
    name: epicName,
    summary: epicSummary,
    description: epicDescription,
    difficulty: epicDifficulty,
    estimatedTime: epicEstimatedTime,
    labels: [type, ...(context.labels || [])],
    stories: stories
  };
}

/**
 * Generate stories for a work area based on goal and analysis
 * Dynamic with complexity-based ranges
 */
function generateStoriesForWorkArea(type, goal, keywords, analysis) {
  const stories = [];

  // Get available story phases for this work area
  const availablePhases = getStoryPhases(type);

  // Dynamically determine how many stories based on goal analysis
  // Use word count as a proxy for detail/scope - more words = more detailed requirements = more stories
  let storyCount;

  // Base calculation: more words = more stories needed
  const baseStoryCount = Math.ceil(analysis.wordCount / 8); // Roughly 1 story per 8 words

  // Adjust based on number of work areas: if many areas, each area gets fewer stories
  const workAreaAdjustment = Math.max(1, analysis.workAreas.length / 2);

  // Adjust based on sentence count: more sentences = more detailed = more stories
  const sentenceBonus = Math.floor(analysis.sentenceCount / 2);

  // Calculate raw story count
  const rawStoryCount = Math.floor(baseStoryCount / workAreaAdjustment) + sentenceBonus;

  // Apply fixed values as defined in manifest.yml prompt
  // COMPLEX goals: 6 stories per epic
  // MEDIUM goals: 3 stories per epic
  // SIMPLE goals: 3 stories per epic
  if (analysis.complexity === 'high') {
    storyCount = 6;
  } else if (analysis.complexity === 'medium') {
    storyCount = 3;
  } else {
    storyCount = 3;
  }

  // Use all available phases up to the calculated count (or all if count exceeds available)
  const storyPhases = availablePhases.slice(0, Math.min(storyCount, availablePhases.length));

  storyPhases.forEach(phase => {
    const story = {
      summary: generateStorySummary(phase, type, goal, keywords),
      description: generateStoryDescription(phase, type, goal),
      acceptanceCriteria: generateAcceptanceCriteria(
        `${phase.action} is complete`,
        'all requirements are met',
        'code is reviewed and tested'
      ),
      subtasks: generateSubtasksForStory(phase, type, goal, analysis)
    };

    // Add difficulty and estimated time
    const subtasksCount = story.subtasks.length;
    story.difficulty = calculateDifficulty(story.summary, story.description, subtasksCount);
    story.estimatedTime = calculateEstimatedTime(story.difficulty, 'story', story.summary, story.description, subtasksCount);

    // Enhance subtasks with difficulty and time
    story.subtasks = story.subtasks.map(subtask => {
      const subtaskDifficulty = calculateDifficulty(subtask.summary, subtask.description || '', 0);
      const subtaskEstimatedTime = calculateEstimatedTime(subtaskDifficulty, 'subtask', subtask.summary, subtask.description || '', 0);
      return {
        ...subtask,
        difficulty: subtaskDifficulty,
        estimatedTime: subtaskEstimatedTime
      };
    });

    stories.push(story);
  });

  return stories;
}

/**
 * Get all available story phases for a work area type
 * Returns full array - caller decides how many to use
 */
function getStoryPhases(type) {
  const phases = {
    frontend: [
      { action: 'Design UI/UX', focus: 'wireframes and mockups' },
      { action: 'Build component library', focus: 'reusable UI elements' },
      { action: 'Implement layouts', focus: 'page structure and routing' },
      { action: 'Add state management', focus: 'data flow and logic' },
      { action: 'Implement user interactions', focus: 'events and feedback' },
      { action: 'Add responsive design', focus: 'mobile and tablet support' },
      { action: 'Optimize performance', focus: 'loading and rendering' },
      { action: 'Add accessibility features', focus: 'WCAG compliance' }
    ],
    backend: [
      { action: 'Design API architecture', focus: 'endpoints and data models' },
      { action: 'Set up database', focus: 'schema and migrations' },
      { action: 'Implement core endpoints', focus: 'CRUD operations' },
      { action: 'Add business logic', focus: 'processing and validation' },
      { action: 'Implement error handling', focus: 'logging and monitoring' },
      { action: 'Add API documentation', focus: 'OpenAPI/Swagger specs' },
      { action: 'Implement caching', focus: 'performance optimization' },
      { action: 'Add rate limiting', focus: 'security and throttling' }
    ],
    auth: [
      { action: 'Design auth architecture', focus: 'authentication strategy' },
      { action: 'Implement registration', focus: 'user signup flow' },
      { action: 'Implement login', focus: 'authentication flow' },
      { action: 'Add authorization', focus: 'role-based access control' },
      { action: 'Implement session management', focus: 'tokens and refresh' },
      { action: 'Add security features', focus: '2FA and password reset' },
      { action: 'Add OAuth integration', focus: 'third-party auth' },
      { action: 'Implement audit logging', focus: 'security tracking' }
    ],
    testing: [
      { action: 'Set up testing infrastructure', focus: 'testing framework' },
      { action: 'Write unit tests', focus: 'component and function tests' },
      { action: 'Write integration tests', focus: 'API and workflow tests' },
      { action: 'Add end-to-end tests', focus: 'user journey testing' },
      { action: 'Perform QA testing', focus: 'manual testing and fixes' },
      { action: 'Set up test automation', focus: 'CI/CD integration' },
      { action: 'Add performance tests', focus: 'load and stress testing' },
      { action: 'Conduct security testing', focus: 'vulnerability assessment' }
    ],
    deployment: [
      { action: 'Design deployment strategy', focus: 'environment planning' },
      { action: 'Set up CI/CD pipeline', focus: 'automated builds and tests' },
      { action: 'Configure staging environment', focus: 'pre-production setup' },
      { action: 'Configure production environment', focus: 'production setup' },
      { action: 'Implement monitoring', focus: 'logging and alerts' },
      { action: 'Deploy to production', focus: 'release and verification' },
      { action: 'Set up rollback procedures', focus: 'disaster recovery' },
      { action: 'Configure auto-scaling', focus: 'performance and reliability' }
    ],
    data: [
      { action: 'Design data architecture', focus: 'schema and models' },
      { action: 'Set up data pipeline', focus: 'ETL and processing' },
      { action: 'Implement data operations', focus: 'migration and sync' },
      { action: 'Add data validation', focus: 'quality and integrity' },
      { action: 'Implement data backup', focus: 'recovery and retention' },
      { action: 'Validate and test data', focus: 'testing and verification' },
      { action: 'Add data governance', focus: 'compliance and policies' },
      { action: 'Optimize data queries', focus: 'performance tuning' }
    ],
    mobile: [
      { action: 'Set up mobile project', focus: 'framework and structure' },
      { action: 'Design mobile UI', focus: 'screens and navigation' },
      { action: 'Build core screens', focus: 'main user interfaces' },
      { action: 'Add platform features', focus: 'iOS and Android specifics' },
      { action: 'Implement offline support', focus: 'local storage and sync' },
      { action: 'Test on devices', focus: 'device testing and optimization' },
      { action: 'Add push notifications', focus: 'user engagement' },
      { action: 'Optimize app performance', focus: 'battery and memory' }
    ],
    documentation: [
      { action: 'Write architecture docs', focus: 'system design and overview' },
      { action: 'Write API documentation', focus: 'endpoint reference' },
      { action: 'Create user guides', focus: 'end-user documentation' },
      { action: 'Write developer guides', focus: 'setup and contribution' },
      { action: 'Add code examples', focus: 'tutorials and samples' },
      { action: 'Create troubleshooting guide', focus: 'common issues and solutions' },
      { action: 'Add release notes', focus: 'changelog and updates' },
      { action: 'Document deployment process', focus: 'operations guide' }
    ],
    implementation: [
      { action: 'Analyze requirements', focus: 'gather and document needs' },
      { action: 'Design solution', focus: 'architecture and approach' },
      { action: 'Implement core functionality', focus: 'main features' },
      { action: 'Add supporting features', focus: 'auxiliary functionality' },
      { action: 'Test and refine', focus: 'quality assurance' },
      { action: 'Document and deploy', focus: 'finalization' },
      { action: 'Gather feedback', focus: 'user acceptance' },
      { action: 'Iterate and improve', focus: 'enhancements' }
    ]
  };

  return phases[type] || phases.implementation;
}

/**
 * Generate a contextual story summary
 */
function generateStorySummary(phase, type, goal, keywords) {
  return `${phase.action}: ${phase.focus}`;
}

/**
 * Generate a story description
 */
function generateStoryDescription(phase, type, goal) {
  return `${phase.action} for the project, focusing on ${phase.focus}.`;
}

/**
 * Generate subtasks for a story
 * Dynamic with complexity-based ranges
 */
function generateSubtasksForStory(phase, type, goal, analysis) {
  // Available subtask templates - represent typical phases of work
  const subtaskTemplates = [
    { summary: `Research and plan ${phase.focus}` },
    { summary: `Design ${phase.focus}` },
    { summary: `Implement ${phase.focus}` },
    { summary: `Test ${phase.focus}` },
    { summary: `Document ${phase.focus}` },
    { summary: `Review and refine ${phase.focus}` },
    { summary: `Deploy ${phase.focus}` }
  ];

  // Dynamically determine subtask count based on multiple factors
  // More complex goals need more granular breakdown

  // Factor 1: Base on word count - more detailed goals need more subtasks
  const wordBasedCount = Math.ceil(analysis.wordCount / 12);

  // Factor 2: Complexity multiplier
  let complexityMultiplier = 1;
  if (analysis.complexity === 'high') complexityMultiplier = 1.5;
  if (analysis.complexity === 'medium') complexityMultiplier = 1.2;

  // Factor 3: Work area type - some areas inherently need more detailed breakdown
  const detailedAreas = ['backend', 'mobile', 'auth', 'data'];
  const typeMultiplier = detailedAreas.includes(type) ? 1.3 : 1;

  // Calculate raw subtask count
  const rawSubtaskCount = Math.ceil(wordBasedCount * complexityMultiplier * typeMultiplier);

  // Apply fixed values as defined in manifest.yml prompt
  // COMPLEX goals: 5 subtasks per story
  // MEDIUM goals: 3 subtasks per story
  // SIMPLE goals: 3 subtasks per story
  let subtaskCount;
  if (analysis.complexity === 'high') {
    subtaskCount = 5;
  } else if (analysis.complexity === 'medium') {
    subtaskCount = 3;
  } else {
    subtaskCount = 3;
  }

  // Return subtasks based on calculated count (up to available templates)
  return subtaskTemplates.slice(0, Math.min(subtaskCount, subtaskTemplates.length));
}

/**
 * Capitalize work area name
 */
function capitalizeWorkArea(type) {
  const names = {
    frontend: 'Frontend Development',
    backend: 'Backend Development',
    auth: 'Authentication & Security',
    testing: 'Testing & Quality Assurance',
    deployment: 'Deployment & DevOps',
    data: 'Data Management',
    mobile: 'Mobile Development',
    documentation: 'Documentation',
    implementation: 'Implementation'
  };
  return names[type] || 'Implementation';
}


/**
 * Generates acceptance criteria in GIVEN/WHEN/THEN format
 */
function generateAcceptanceCriteria(given, when, then) {
  return `GIVEN ${given}
WHEN ${when}
THEN ${then}`;
}

/**
 * Calculate difficulty level based on number of subtasks and complexity indicators
 */
function calculateDifficulty(summary, description, subtasksCount = 0) {
  const complexityIndicators = ['integration', 'migration', 'refactor', 'architecture', 'security', 'authentication', 'deployment', 'database'];
  const text = `${summary} ${description || ''}`.toLowerCase();

  let complexityScore = 0;
  complexityIndicators.forEach(indicator => {
    if (text.includes(indicator)) complexityScore++;
  });

  if (subtasksCount >= 4 || complexityScore >= 3) return 'Hard';
  if (subtasksCount >= 2 || complexityScore >= 1) return 'Medium';
  return 'Easy';
}

/**
 * Calculate estimated time based on difficulty, type, and context analysis
 */
function calculateEstimatedTime(difficulty, type = 'story', summary = '', description = '', subtasksCount = 0) {
  const text = `${summary} ${description}`.toLowerCase();

  // Analyze content for time-impacting factors
  const factors = {
    // Long-duration indicators
    migration: text.includes('migration') || text.includes('migrate'),
    refactor: text.includes('refactor') || text.includes('restructure'),
    integration: text.includes('integration') || text.includes('integrate') || text.includes('third-party'),
    architecture: text.includes('architecture') || text.includes('design system'),
    database: text.includes('database') || text.includes('schema') || text.includes('data model'),
    security: text.includes('security') || text.includes('authentication') || text.includes('authorization'),
    deployment: text.includes('deployment') || text.includes('ci/cd') || text.includes('pipeline'),
    testing: text.includes('testing') || text.includes('qa') || text.includes('test coverage'),

    // Medium-duration indicators
    api: text.includes('api') || text.includes('endpoint'),
    ui: text.includes('ui') || text.includes('interface') || text.includes('component'),
    documentation: text.includes('document') || text.includes('guide') || text.includes('readme'),

    // Quick tasks
    bugfix: text.includes('fix') || text.includes('bug'),
    update: text.includes('update') && !text.includes('major'),
    configure: text.includes('configure') || text.includes('config'),
    research: text.includes('research') || text.includes('investigate')
  };

  // Calculate complexity multiplier based on factors
  let complexityMultiplier = 1;

  if (factors.migration || factors.refactor || factors.architecture) complexityMultiplier += 0.5;
  if (factors.integration || factors.database || factors.security) complexityMultiplier += 0.4;
  if (factors.deployment || factors.testing) complexityMultiplier += 0.3;
  if (factors.api || factors.ui) complexityMultiplier += 0.2;
  if (factors.documentation) complexityMultiplier += 0.1;
  if (factors.bugfix && difficulty === 'Easy') complexityMultiplier -= 0.2;
  if (factors.research) complexityMultiplier += 0.15;

  // Adjust for number of subtasks
  if (subtasksCount > 0) {
    complexityMultiplier += subtasksCount * 0.1;
  }

  // Calculate base hours based on type and difficulty
  let baseHours;

  if (type === 'epic') {
    // Base hours for epics (in weeks converted to hours: 40 hours/week)
    if (difficulty === 'Easy') baseHours = 80; // 2 weeks
    else if (difficulty === 'Medium') baseHours = 200; // 5 weeks
    else baseHours = 400; // 10 weeks
  } else if (type === 'story') {
    // Base hours for stories
    if (difficulty === 'Easy') baseHours = 3;
    else if (difficulty === 'Medium') baseHours = 12; // 1.5 days
    else baseHours = 28; // 3.5 days
  } else { // subtask
    // Base hours for subtasks
    if (difficulty === 'Easy') baseHours = 0.75; // 45 min
    else if (difficulty === 'Medium') baseHours = 3;
    else baseHours = 6;
  }

  // Apply complexity multiplier
  const estimatedHours = baseHours * complexityMultiplier;

  // Convert to human-readable format
  return formatEstimatedTime(estimatedHours, type);
}

/**
 * Format estimated hours into human-readable time
 */
function formatEstimatedTime(hours, type) {
  if (type === 'epic') {
    // For epics, express in weeks
    const weeks = Math.ceil(hours / 40);
    if (weeks === 1) return '1 week';
    if (weeks <= 2) return '1-2 weeks';
    if (weeks <= 4) return '2-4 weeks';
    if (weeks <= 6) return '4-6 weeks';
    if (weeks <= 8) return '6-8 weeks';
    if (weeks <= 12) return '8-12 weeks';
    return `${weeks} weeks`;
  } else if (type === 'story') {
    // For stories, express in hours or days
    if (hours < 1) return `${Math.ceil(hours * 60)} minutes`;
    if (hours <= 4) return `${Math.ceil(hours)} hours`;
    if (hours <= 8) return `${Math.ceil(hours)} hours (1 day)`;
    const days = Math.ceil(hours / 8);
    if (days <= 5) return `${days} days`;
    const weeks = Math.ceil(days / 5);
    return `${weeks} week${weeks > 1 ? 's' : ''}`;
  } else { // subtask
    // For subtasks, express in minutes or hours
    if (hours < 1) return `${Math.ceil(hours * 60)} minutes`;
    if (hours < 2) return `${Math.ceil(hours * 2) / 2} hour${hours >= 1.5 ? 's' : ''}`;
    if (hours <= 8) return `${Math.ceil(hours)} hours`;
    return `${Math.ceil(hours)} hours (more than 1 day)`;
  }
}

/**
 * Truncates text to a maximum length with ellipsis
 */
function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Converts text with newlines into Atlassian Document Format (ADF)
 * Properly handles paragraphs and formatting
 */
function textToADF(text) {
  const lines = text.split('\n');
  const content = [];

  for (const line of lines) {
    if (line.trim() === '') {
      // Empty line - add empty paragraph for spacing
      content.push({
        type: 'paragraph',
        content: []
      });
    } else if (line.startsWith('//')) {
      // Comment line - use code block for visibility
      content.push({
        type: 'paragraph',
        content: [{
          type: 'text',
          text: line,
          marks: [{ type: 'code' }]
        }]
      });
    } else if (line.startsWith('*') && line.endsWith('*') && line.length > 2) {
      // Bold text like *Acceptance Criteria:*
      content.push({
        type: 'paragraph',
        content: [{
          type: 'text',
          text: line.substring(1, line.length - 1),
          marks: [{ type: 'strong' }]
        }]
      });
    } else {
      // Regular text
      content.push({
        type: 'paragraph',
        content: [{
          type: 'text',
          text: line
        }]
      });
    }
  }

  return {
    type: 'doc',
    version: 1,
    content: content
  };
}

/**
 * Gets the available issue types for a project and finds the best match
 */
async function getProjectIssueTypes(projectKey) {
  try {
    const response = await api.asApp().requestJira(
      route`/rest/api/3/project/${projectKey}`,
      {
        headers: {
          'Accept': 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get project info: ${response.status}`);
    }

    const project = await response.json();
    const issueTypes = project.issueTypes || [];

    // Find Epic type
    const epicType = issueTypes.find(t =>
      t.name.toLowerCase() === 'epic'
    );

    // Find Story/Task type (prefer Story, fallback to Task)
    const storyType = issueTypes.find(t =>
      t.name.toLowerCase() === 'story' ||
      t.name.toLowerCase() === 'task' ||
      t.name.toLowerCase() === 'user story'
    );

    // Find Subtask type
    const subtaskType = issueTypes.find(t =>
      t.subtask === true ||
      t.name.toLowerCase() === 'subtask' ||
      t.name.toLowerCase() === 'sub-task'
    );

    return {
      epic: epicType?.name || 'Epic',
      story: storyType?.name || 'Task',
      subtask: subtaskType?.name || 'Subtask'
    };
  } catch (error) {
    // Fallback to common defaults
    return {
      epic: 'Epic',
      story: 'Task',
      subtask: 'Subtask'
    };
  }
}

/**
 * Creates Jira issues (Epics, Stories, Subtasks) based on the plan structure.
 * Also creates links between issues and adds metadata.
 *
 * @param {string} projectKey - The Jira project key
 * @param {object} plan - The structured plan with epics and stories
 * @param {string} originalGoal - The original goal text
 * @param {object} context - Additional context (components, owners, etc.)
 * @returns {object} Details of all created issues
 */
async function createJiraIssues(projectKey, plan, originalGoal, context = {}) {
  const createdIssues = {
    epics: [],
    stories: [],
    subtasks: [],
    timestamp: new Date().toISOString()
  };

  try {
    // Get chat history to check for duplicates
    const chatHistory = await getChatHistory();

    // First, get the correct issue type names for this project
    const issueTypes = await getProjectIssueTypes(projectKey);
    // Create each epic
    for (const epicData of plan.epics) {
      // Check if epic already exists in chat history
      if (isDuplicate(epicData.summary, chatHistory.createdEpics)) {
        continue; // Skip duplicate epic
      }

      // Create the epic with difficulty and time in description
      const epicDescriptionText = `${epicData.description}\n\n// Difficulty: ${epicData.difficulty}\n// Estimated Time: ${epicData.estimatedTime}`;

      // Create labels with difficulty and estimated time (no spaces allowed in labels)
      const epicLabels = [
        ...(epicData.labels || []),
        `Difficulty:${epicData.difficulty}`,
        `Time:${epicData.estimatedTime.replace(/\s+/g, '')}`
      ];

      const epicResponse = await api.asApp().requestJira(route`/rest/api/3/issue`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fields: {
            project: { key: projectKey },
            summary: epicData.summary,
            description: textToADF(epicDescriptionText),
            issuetype: { name: issueTypes.epic },
            labels: epicLabels,
            ...(context.components && { components: context.components.map(name => ({ name })) })
          }
        })
      });

      // Check if epic creation was successful
      if (!epicResponse.ok) {
        const errorText = await epicResponse.text();
        throw new Error(`Failed to create epic: ${errorText}`);
      }

      const epic = await epicResponse.json();

      const epicRecord = {
        key: epic.key,
        id: epic.id,
        summary: epicData.summary
      };
      createdIssues.epics.push(epicRecord);

      // Add to chat history
      chatHistory.createdEpics.push(epicRecord);

      // Create stories for this epic
      for (const storyData of epicData.stories) {
        // Check if story already exists in chat history
        if (isDuplicate(storyData.summary, chatHistory.createdStories)) {
          continue; // Skip duplicate story
        }

        // Build description with acceptance criteria, difficulty and time
        const storyDescription = `${storyData.description}\n\n*Acceptance Criteria:*\n${storyData.acceptanceCriteria}\n\n// Difficulty: ${storyData.difficulty}\n// Estimated Time: ${storyData.estimatedTime}`;

        // Create labels with difficulty and estimated time (no spaces allowed in labels)
        const storyLabels = [
          ...(storyData.labels || []),
          `Difficulty:${storyData.difficulty}`,
          `Time:${storyData.estimatedTime.replace(/\s+/g, '')}`
        ];

        const storyResponse = await api.asApp().requestJira(route`/rest/api/3/issue`, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            fields: {
              project: { key: projectKey },
              summary: storyData.summary,
              description: textToADF(storyDescription),
              issuetype: { name: issueTypes.story },
              labels: storyLabels,
              parent: { key: epic.key }, // Link to epic
              ...(context.components && { components: context.components.map(name => ({ name })) }),
              ...(context.assignee && { assignee: { accountId: context.assignee } })
            }
          })
        });

        // Check if story creation was successful
        if (!storyResponse.ok) {
          const errorText = await storyResponse.text();
          throw new Error(`Failed to create story: ${errorText}`);
        }

        const story = await storyResponse.json();

        const storyRecord = {
          key: story.key,
          id: story.id,
          summary: storyData.summary,
          epicKey: epic.key
        };
        createdIssues.stories.push(storyRecord);

        // Add to chat history
        chatHistory.createdStories.push(storyRecord);

        // Create subtasks for this story
        if (storyData.subtasks && storyData.subtasks.length > 0) {
          for (const subtaskData of storyData.subtasks) {
            // Check if subtask already exists in chat history
            if (isDuplicate(subtaskData.summary, chatHistory.createdSubtasks)) {
              continue; // Skip duplicate subtask
            }

            // Build subtask description with difficulty and time
            const subtaskDescriptionText = `${subtaskData.description || ''}\n\n// Difficulty: ${subtaskData.difficulty}\n// Estimated Time: ${subtaskData.estimatedTime}`;

            // Create labels with difficulty and estimated time (no spaces allowed in labels)
            const subtaskLabels = [
              `Difficulty:${subtaskData.difficulty}`,
              `Time:${subtaskData.estimatedTime.replace(/\s+/g, '')}`
            ];

            const subtaskResponse = await api.asApp().requestJira(route`/rest/api/3/issue`, {
              method: 'POST',
              headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                fields: {
                  project: { key: projectKey },
                  summary: subtaskData.summary,
                  description: textToADF(subtaskDescriptionText),
                  issuetype: { name: issueTypes.subtask },
                  labels: subtaskLabels,
                  parent: { key: story.key }, // Link to story
                  ...(context.assignee && { assignee: { accountId: context.assignee } })
                }
              })
            });

            // Check if subtask creation was successful
            if (!subtaskResponse.ok) {
              const errorText = await subtaskResponse.text();
              throw new Error(`Failed to create subtask: ${errorText}`);
            }

            const subtask = await subtaskResponse.json();

            const subtaskRecord = {
              key: subtask.key,
              id: subtask.id,
              summary: subtaskData.summary,
              storyKey: story.key
            };
            createdIssues.subtasks.push(subtaskRecord);

            // Add to chat history
            chatHistory.createdSubtasks.push(subtaskRecord);
          }
        }
      }
    }

    // Save updated chat history
    await saveChatHistory(chatHistory);

    // Add plan provenance metadata to the first epic using issue properties
    if (createdIssues.epics.length > 0) {
      const firstEpic = createdIssues.epics[0];
      const provenanceData = {
        generatedBy: 'Rovo Plan Generator',
        timestamp: createdIssues.timestamp,
        originalGoal: originalGoal,
        context: context,
        totalEpics: createdIssues.epics.length,
        totalStories: createdIssues.stories.length,
        totalSubtasks: createdIssues.subtasks.length
      };

      await api.asApp().requestJira(
        route`/rest/api/3/issue/${firstEpic.key}/properties/plan-provenance`,
        {
          method: 'PUT',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(provenanceData)
        }
      );
    }

  } catch (error) {
    throw error;
  }

  return createdIssues;
}

