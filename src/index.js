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

    // Return summary for the Rovo agent to share with the user
    return {
      success: true,
      message: `Successfully created ${createdIssues.epics.length} epics, ${createdIssues.stories.length} stories, and ${createdIssues.subtasks.length} subtasks in project ${projectKey}!`,
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

  return {
    workAreas,
    complexity: words > 100 ? 'high' : words > 30 ? 'medium' : 'low',
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
    difficulty: epicDifficulty, // Difficulty: Easy|Medium|Hard
    estimatedTime: epicEstimatedTime, // Estimated time: e.g., "2-4 weeks"
    labels: [type, ...(context.labels || [])],
    stories: stories
  };
}

/**
 * Generate stories for a work area based on goal and analysis
 */
function generateStoriesForWorkArea(type, goal, keywords, analysis) {
  const stories = [];

  // Determine number of stories based on complexity
  const storyCount = analysis.complexity === 'high' ? 4 : analysis.complexity === 'medium' ? 3 : 2;

  // Generate contextual stories based on work area type
  const storyPhases = getStoryPhases(type, storyCount);

  storyPhases.forEach(phase => {
    const story = {
      summary: generateStorySummary(phase, type, goal, keywords),
      description: generateStoryDescription(phase, type, goal),
      acceptanceCriteria: generateAcceptanceCriteria(
        `${phase.action} is complete`,
        'all requirements are met',
        'code is reviewed and tested'
      ),
      subtasks: generateSubtasksForStory(phase, type, goal)
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
        difficulty: subtaskDifficulty, // Difficulty: Easy|Medium|Hard
        estimatedTime: subtaskEstimatedTime // Estimated time: e.g., "2 hours"
      };
    });

    stories.push(story);
  });

  return stories;
}

/**
 * Get story phases based on work area type and count
 */
function getStoryPhases(type, count) {
  const phases = {
    frontend: [
      { action: 'Design UI/UX', focus: 'wireframes and mockups' },
      { action: 'Build components', focus: 'reusable UI elements' },
      { action: 'Implement state management', focus: 'data flow and logic' },
      { action: 'Add interactivity', focus: 'user interactions' }
    ],
    backend: [
      { action: 'Design API', focus: 'endpoints and data models' },
      { action: 'Implement endpoints', focus: 'CRUD operations' },
      { action: 'Set up database', focus: 'schema and migrations' },
      { action: 'Add business logic', focus: 'processing and validation' }
    ],
    auth: [
      { action: 'Design auth flow', focus: 'authentication strategy' },
      { action: 'Implement login/signup', focus: 'user authentication' },
      { action: 'Add authorization', focus: 'access control' }
    ],
    testing: [
      { action: 'Set up testing infrastructure', focus: 'testing framework' },
      { action: 'Write tests', focus: 'unit and integration tests' },
      { action: 'Perform QA', focus: 'manual testing and fixes' }
    ],
    deployment: [
      { action: 'Set up CI/CD', focus: 'automated pipeline' },
      { action: 'Configure production', focus: 'environment setup' },
      { action: 'Deploy to production', focus: 'release and verification' }
    ],
    data: [
      { action: 'Design data structure', focus: 'schema and models' },
      { action: 'Implement data operations', focus: 'migration and sync' },
      { action: 'Validate data', focus: 'testing and verification' }
    ],
    mobile: [
      { action: 'Set up mobile project', focus: 'framework and structure' },
      { action: 'Build mobile UI', focus: 'screens and navigation' },
      { action: 'Add mobile features', focus: 'platform-specific functionality' }
    ],
    documentation: [
      { action: 'Write technical docs', focus: 'API and architecture' },
      { action: 'Create user guides', focus: 'end-user documentation' }
    ],
    implementation: [
      { action: 'Analyze requirements', focus: 'gather and document needs' },
      { action: 'Implement solution', focus: 'core functionality' },
      { action: 'Test and refine', focus: 'quality assurance' }
    ]
  };

  const areaPhases = phases[type] || phases.implementation;
  return areaPhases.slice(0, count);
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
 */
function generateSubtasksForStory(phase, type, goal) {
  // Generate 2-4 subtasks per story based on phase
  const subtaskCount = Math.floor(Math.random() * 3) + 2; // 2-4 subtasks
  const subtasks = [];

  const genericSubtaskTemplates = [
    { summary: `Research and plan ${phase.focus}` },
    { summary: `Implement ${phase.focus}` },
    { summary: `Test ${phase.focus}` },
    { summary: `Document ${phase.focus}` }
  ];

  return genericSubtaskTemplates.slice(0, subtaskCount);
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

