import api, { route } from '@forge/api';

/**
 * Rovo Action: Creates a complete Jira plan automatically from a goal
 * This is called directly by the Rovo agent when user provides a goal
 */
export async function createJiraPlanAction(payload) {
  try {
    const { projectKey, goal } = payload;

    console.log(`[Rovo Action] Creating plan for project: ${projectKey}`);
    console.log(`[Rovo Action] Goal: ${goal}`);

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
    console.error('[Rovo Action] Error creating plan:', error);
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

    console.log(`Received plan generation request for project: ${projectKey}`);
    console.log(`Goal: ${goal}`);
    console.log(`Context: ${JSON.stringify(context)}`);

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
    console.error('Error generating plan:', error);
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
 * Uses simple rules and templates to break down the goal.
 *
 * @param {string} goal - The goal description from the user
 * @param {object} context - Additional context (labels, components, owners, etc.)
 * @returns {object} Structured plan with epics, stories, and subtasks
 */
function parseGoalIntoPlan(goal, context = {}) {
  console.log('Parsing goal into structured plan...');

  // Analyze the goal to determine complexity and break it down
  const goalLower = goal.toLowerCase();
  const plan = {
    epics: []
  };

  // Simple pattern matching to identify work areas
  // These are common patterns in project goals
  const patterns = {
    frontend: /frontend|ui|interface|design|user experience|ux|screen|page|component/i,
    backend: /backend|api|server|database|service|endpoint|integration/i,
    auth: /auth|login|security|permission|access control|sign[- ]?in|sign[- ]?up/i,
    testing: /test|qa|quality|validation|verification/i,
    deployment: /deploy|release|ci\/cd|pipeline|build|production/i,
    documentation: /document|doc|readme|guide|instruction/i,
    data: /data|migration|import|export|sync/i,
    mobile: /mobile|ios|android|app/i,
  };

  // Identify which areas are mentioned in the goal
  const detectedAreas = [];
  for (const [area, pattern] of Object.entries(patterns)) {
    if (pattern.test(goal)) {
      detectedAreas.push(area);
    }
  }

  // If no specific areas detected, create a general implementation epic
  if (detectedAreas.length === 0) {
    detectedAreas.push('implementation');
  }

  // Generate epics based on detected areas
  detectedAreas.forEach((area, index) => {
    const epic = createEpicForArea(area, goal, context);
    plan.epics.push(epic);
  });

  // Always add a planning/discovery epic if the goal is complex
  if (detectedAreas.length > 2 || goal.length > 200) {
    plan.epics.unshift({
      name: 'Planning & Discovery',
      summary: `Plan and research for: ${truncateText(goal, 60)}`,
      description: `Initial planning and discovery phase for the project:\n\n${goal}`,
      labels: ['planning', 'discovery', ...(context.labels || [])],
      stories: [
        {
          summary: 'Define technical requirements and architecture',
          description: 'Document technical requirements, architecture decisions, and technology stack.',
          acceptanceCriteria: generateAcceptanceCriteria('Technical requirements documented', 'architecture review completed', 'Requirements are approved by stakeholders'),
          subtasks: [
            { summary: 'Research technical options and best practices' },
            { summary: 'Create architecture diagram' },
            { summary: 'Document technology stack decisions' }
          ]
        },
        {
          summary: 'Create project timeline and milestones',
          description: 'Break down the project into phases with clear milestones and deliverables.',
          acceptanceCriteria: generateAcceptanceCriteria('Project timeline created', 'milestones defined', 'Timeline is reviewed and approved'),
          subtasks: [
            { summary: 'Identify project phases' },
            { summary: 'Define key milestones and deliverables' }
          ]
        }
      ]
    });
  }

  return plan;
}

/**
 * Creates an epic structure for a specific work area
 */
function createEpicForArea(area, goal, context) {
  const epicTemplates = {
    frontend: {
      name: 'Frontend Development',
      stories: [
        {
          summary: 'Design UI/UX mockups and wireframes',
          description: 'Create user interface designs and user experience flow.',
          subtasks: [
            { summary: 'Create wireframes for key screens' },
            { summary: 'Design UI components and style guide' },
            { summary: 'Get design approval from stakeholders' }
          ]
        },
        {
          summary: 'Implement frontend components',
          description: 'Build reusable UI components based on designs.',
          subtasks: [
            { summary: 'Set up frontend project structure' },
            { summary: 'Implement core UI components' },
            { summary: 'Add responsive design support' }
          ]
        },
        {
          summary: 'Implement client-side logic and state management',
          description: 'Add business logic and state management to the frontend.',
          subtasks: [
            { summary: 'Set up state management (Redux/Context)' },
            { summary: 'Implement data fetching and caching' },
            { summary: 'Add form validation and error handling' }
          ]
        }
      ]
    },
    backend: {
      name: 'Backend Development',
      stories: [
        {
          summary: 'Design API endpoints and data models',
          description: 'Define API contracts and database schema.',
          subtasks: [
            { summary: 'Design REST API endpoints' },
            { summary: 'Create database schema' },
            { summary: 'Document API specifications' }
          ]
        },
        {
          summary: 'Implement API endpoints',
          description: 'Build server-side API endpoints with proper validation.',
          subtasks: [
            { summary: 'Set up backend framework and structure' },
            { summary: 'Implement CRUD operations' },
            { summary: 'Add input validation and sanitization' }
          ]
        },
        {
          summary: 'Set up database and data access layer',
          description: 'Implement database connections and data access patterns.',
          subtasks: [
            { summary: 'Configure database connection' },
            { summary: 'Create database migration scripts' },
            { summary: 'Implement data access layer (DAL/ORM)' }
          ]
        }
      ]
    },
    auth: {
      name: 'Authentication & Security',
      stories: [
        {
          summary: 'Design authentication flow',
          description: 'Plan authentication mechanism and user flow.',
          subtasks: [
            { summary: 'Choose authentication method (JWT/OAuth/etc)' },
            { summary: 'Design login/signup user flow' },
            { summary: 'Plan session management strategy' }
          ]
        },
        {
          summary: 'Implement user registration and login',
          description: 'Build user authentication endpoints and UI.',
          subtasks: [
            { summary: 'Create registration endpoint with validation' },
            { summary: 'Implement login endpoint with password hashing' },
            { summary: 'Build login/signup UI forms' }
          ]
        },
        {
          summary: 'Add authorization and access control',
          description: 'Implement role-based access control and permissions.',
          subtasks: [
            { summary: 'Define user roles and permissions' },
            { summary: 'Implement authorization middleware' },
            { summary: 'Add protected routes/endpoints' }
          ]
        }
      ]
    },
    testing: {
      name: 'Testing & Quality Assurance',
      stories: [
        {
          summary: 'Set up testing infrastructure',
          description: 'Configure testing frameworks and CI integration.',
          subtasks: [
            { summary: 'Set up unit testing framework' },
            { summary: 'Configure integration testing tools' },
            { summary: 'Set up test coverage reporting' }
          ]
        },
        {
          summary: 'Write unit and integration tests',
          description: 'Create comprehensive test coverage for key functionality.',
          subtasks: [
            { summary: 'Write unit tests for core functions' },
            { summary: 'Create integration tests for API endpoints' },
            { summary: 'Add frontend component tests' }
          ]
        },
        {
          summary: 'Perform QA and user acceptance testing',
          description: 'Conduct thorough testing with real users.',
          subtasks: [
            { summary: 'Create test cases and scenarios' },
            { summary: 'Execute manual testing' },
            { summary: 'Document and fix identified bugs' }
          ]
        }
      ]
    },
    deployment: {
      name: 'Deployment & DevOps',
      stories: [
        {
          summary: 'Set up CI/CD pipeline',
          description: 'Configure automated build and deployment pipeline.',
          subtasks: [
            { summary: 'Configure build automation' },
            { summary: 'Set up automated testing in pipeline' },
            { summary: 'Configure deployment automation' }
          ]
        },
        {
          summary: 'Configure production environment',
          description: 'Set up and secure production infrastructure.',
          subtasks: [
            { summary: 'Provision production servers/cloud resources' },
            { summary: 'Configure environment variables' },
            { summary: 'Set up monitoring and logging' }
          ]
        },
        {
          summary: 'Deploy to production',
          description: 'Execute production deployment and verify.',
          subtasks: [
            { summary: 'Run pre-deployment checks' },
            { summary: 'Execute production deployment' },
            { summary: 'Verify deployment and run smoke tests' }
          ]
        }
      ]
    },
    documentation: {
      name: 'Documentation',
      stories: [
        {
          summary: 'Write technical documentation',
          description: 'Create comprehensive technical documentation.',
          subtasks: [
            { summary: 'Document API endpoints and usage' },
            { summary: 'Write architecture documentation' },
            { summary: 'Create developer setup guide' }
          ]
        },
        {
          summary: 'Create user documentation',
          description: 'Write end-user guides and help documentation.',
          subtasks: [
            { summary: 'Write user manual' },
            { summary: 'Create tutorial videos or guides' },
            { summary: 'Document common troubleshooting steps' }
          ]
        }
      ]
    },
    data: {
      name: 'Data Management',
      stories: [
        {
          summary: 'Design data structure and schema',
          description: 'Plan data models and relationships.',
          subtasks: [
            { summary: 'Define entity relationships' },
            { summary: 'Create database schema design' },
            { summary: 'Plan data validation rules' }
          ]
        },
        {
          summary: 'Implement data migration/import',
          description: 'Build tools to migrate or import existing data.',
          subtasks: [
            { summary: 'Create migration scripts' },
            { summary: 'Implement data validation' },
            { summary: 'Test migration with sample data' }
          ]
        }
      ]
    },
    mobile: {
      name: 'Mobile Development',
      stories: [
        {
          summary: 'Set up mobile app project',
          description: 'Initialize mobile app development environment.',
          subtasks: [
            { summary: 'Choose mobile framework (React Native/Flutter/Native)' },
            { summary: 'Set up project structure' },
            { summary: 'Configure build tools' }
          ]
        },
        {
          summary: 'Implement mobile UI',
          description: 'Build mobile user interface with native feel.',
          subtasks: [
            { summary: 'Create mobile-optimized screens' },
            { summary: 'Implement navigation' },
            { summary: 'Add platform-specific features' }
          ]
        }
      ]
    },
    implementation: {
      name: 'Implementation',
      stories: [
        {
          summary: 'Analyze requirements and create technical spec',
          description: `Analyze the requirements for: ${truncateText(goal, 100)}`,
          subtasks: [
            { summary: 'Gather detailed requirements' },
            { summary: 'Create technical specification' },
            { summary: 'Get stakeholder approval' }
          ]
        },
        {
          summary: 'Implement core functionality',
          description: 'Build the main features and functionality.',
          subtasks: [
            { summary: 'Set up project structure' },
            { summary: 'Implement core features' },
            { summary: 'Add error handling' }
          ]
        },
        {
          summary: 'Testing and quality assurance',
          description: 'Test the implementation thoroughly.',
          subtasks: [
            { summary: 'Write automated tests' },
            { summary: 'Perform manual testing' },
            { summary: 'Fix identified issues' }
          ]
        }
      ]
    }
  };

  // Get the template for this area, or use implementation as default
  const template = epicTemplates[area] || epicTemplates.implementation;

  // Add acceptance criteria to each story
  const storiesWithAC = template.stories.map(story => ({
    ...story,
    acceptanceCriteria: story.acceptanceCriteria || generateAcceptanceCriteria(
      `${story.summary} is complete`,
      'all subtasks are done',
      'Changes are reviewed and tested'
    ),
    labels: [...(context.labels || []), area]
  }));

  return {
    name: template.name,
    summary: `${template.name}: ${truncateText(goal, 60)}`,
    description: `Epic for ${template.name.toLowerCase()} work related to:\n\n${goal}`,
    labels: [area, ...(context.labels || [])],
    stories: storiesWithAC
  };
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
 * Truncates text to a maximum length with ellipsis
 */
function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
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
  console.log('Creating Jira issues...');

  const createdIssues = {
    epics: [],
    stories: [],
    subtasks: [],
    timestamp: new Date().toISOString()
  };

  try {
    // Create each epic
    for (const epicData of plan.epics) {
      console.log(`Creating epic: ${epicData.name}`);

      // Create the epic
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
            description: {
              type: 'doc',
              version: 1,
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: epicData.description }]
                }
              ]
            },
            issuetype: { name: 'Epic' },
            labels: epicData.labels || [],
            ...(context.components && { components: context.components.map(name => ({ name })) })
          }
        })
      });

      const epic = await epicResponse.json();
      console.log(`Created epic: ${epic.key}`);

      createdIssues.epics.push({
        key: epic.key,
        id: epic.id,
        summary: epicData.summary
      });

      // Create stories for this epic
      for (const storyData of epicData.stories) {
        console.log(`Creating story: ${storyData.summary}`);

        // Build description with acceptance criteria
        const storyDescription = `${storyData.description}\n\n*Acceptance Criteria:*\n${storyData.acceptanceCriteria}`;

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
              description: {
                type: 'doc',
                version: 1,
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: storyDescription }]
                  }
                ]
              },
              issuetype: { name: 'Story' },
              labels: storyData.labels || [],
              parent: { key: epic.key }, // Link to epic
              ...(context.components && { components: context.components.map(name => ({ name })) }),
              ...(context.assignee && { assignee: { accountId: context.assignee } })
            }
          })
        });

        const story = await storyResponse.json();
        console.log(`Created story: ${story.key}`);

        createdIssues.stories.push({
          key: story.key,
          id: story.id,
          summary: storyData.summary,
          epicKey: epic.key
        });

        // Create subtasks for this story
        if (storyData.subtasks && storyData.subtasks.length > 0) {
          for (const subtaskData of storyData.subtasks) {
            console.log(`Creating subtask: ${subtaskData.summary}`);

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
                  description: subtaskData.description ? {
                    type: 'doc',
                    version: 1,
                    content: [
                      {
                        type: 'paragraph',
                        content: [{ type: 'text', text: subtaskData.description }]
                      }
                    ]
                  } : undefined,
                  issuetype: { name: 'Subtask' },
                  parent: { key: story.key }, // Link to story
                  ...(context.assignee && { assignee: { accountId: context.assignee } })
                }
              })
            });

            const subtask = await subtaskResponse.json();
            console.log(`Created subtask: ${subtask.key}`);

            createdIssues.subtasks.push({
              key: subtask.key,
              id: subtask.id,
              summary: subtaskData.summary,
              storyKey: story.key
            });
          }
        }
      }
    }

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

      console.log('Added plan provenance metadata to epic');
    }

    console.log(`Successfully created ${createdIssues.epics.length} epics, ${createdIssues.stories.length} stories, and ${createdIssues.subtasks.length} subtasks`);

  } catch (error) {
    console.error('Error creating Jira issues:', error);
    throw error;
  }

  return createdIssues;
}

