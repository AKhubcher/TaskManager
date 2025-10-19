# Jira Plan Generator - Rovo-Powered Forge App

An AI-powered Forge app that automatically generates structured Jira plans (Epics → Stories → Subtasks) from messy, natural language goals typed directly in Rovo chat.

## Features

- **Fully Automatic**: Type a messy goal in Rovo → Get complete Jira plan instantly
- **No Manual Steps**: No redirects, no acceptance UI, no clicking around
- **AI-Powered Planning**: Analyzes your goal and automatically generates relevant epics, stories, and subtasks
- **Smart Pattern Detection**: Detects work areas (frontend, backend, auth, testing, deployment, etc.)
- **Acceptance Criteria**: Auto-generates GIVEN/WHEN/THEN acceptance criteria for all stories
- **Plan Provenance**: Tracks when and how plans were generated

## How It Works - Complete User Flow

### Example 1: Simple Goal

**User types in Rovo:**
```
Build me a payment system
```

**Rovo Agent responds:**
```
What's your Jira project key?
```

**User:**
```
PROJ
```

**Rovo Agent:**
```
✓ Done! Created 2 epics, 6 stories, and 18 subtasks in project PROJ!

Your plan includes:
- Planning & Discovery epic
- Implementation epic

Check your Jira project to see all the tasks!
```

**In Jira (automatically created):**
```
PROJ-1 [Epic] Planning & Discovery
  ├─ PROJ-2 [Story] Define technical requirements and architecture
  │   ├─ PROJ-3 [Subtask] Research technical options and best practices
  │   ├─ PROJ-4 [Subtask] Create architecture diagram
  │   └─ PROJ-5 [Subtask] Document technology stack decisions
  ├─ PROJ-6 [Story] Create project timeline and milestones
  │   ├─ PROJ-7 [Subtask] Identify project phases
  │   └─ PROJ-8 [Subtask] Define key milestones and deliverables

PROJ-9 [Epic] Implementation
  ├─ PROJ-10 [Story] Analyze requirements and create technical spec
  │   ├─ PROJ-11 [Subtask] Gather detailed requirements
  │   ├─ PROJ-12 [Subtask] Create technical specification
  │   └─ PROJ-13 [Subtask] Get stakeholder approval
  ... (and more)
```

### Example 2: Complex Goal

**User types in Rovo:**
```
Create a plan for a full-stack e-commerce site with user auth,
product catalog, shopping cart, checkout, and admin dashboard in project SHOP
```

**Rovo Agent:**
```
✓ Created 5 epics, 15 stories, and 45 subtasks in project SHOP!

Your plan includes:
- Planning & Discovery
- Frontend Development
- Backend Development
- Authentication & Security
- Testing & Quality Assurance

All tasks are ready in your Jira project!
```

### Example 3: Very Specific Goal

**User types in Rovo:**
```
I need to build a mobile app with real-time chat, push notifications,
and offline support. Project key is MOBILE
```

**Rovo Agent:**
```
✓ Created 4 epics, 12 stories, and 36 subtasks in project MOBILE!

Your plan includes:
- Planning & Discovery
- Mobile Development
- Backend Development
- Testing & Quality Assurance

Check MOBILE in Jira to see all the details!
```

## Architecture

### Pattern Detection

The AI analyzes your goal for these patterns:

| Pattern | Keywords |
|---------|----------|
| **Frontend** | UI, interface, design, UX, screen, page, component |
| **Backend** | API, server, database, service, endpoint, integration |
| **Authentication** | Auth, login, security, permission, access control, sign-in |
| **Testing** | Test, QA, quality, validation, verification |
| **Deployment** | Deploy, release, CI/CD, pipeline, build, production |
| **Documentation** | Document, docs, README, guide, instruction |
| **Data** | Data, migration, import, export, sync |
| **Mobile** | Mobile, iOS, Android, app |

### Generated Structure

**For each detected area:**
- 1 Epic with descriptive summary
- 2-3 Stories per epic with acceptance criteria (GIVEN/WHEN/THEN)
- 2-4 Subtasks per story with actionable items

**Complex goals** (>200 chars or 3+ areas) get an additional Planning & Discovery epic.

## Installation

### Prerequisites

- Forge CLI installed: `npm install -g @forge/cli`
- Atlassian account with Jira and Rovo access
- Node.js 18+ installed

### Deploy & Install

1. **Deploy the app:**
   ```bash
   forge deploy --non-interactive -e development
   ```

2. **Install to your Jira site:**
   ```bash
   forge install --non-interactive --site <your-site>.atlassian.net --product jira --environment development
   ```

3. **Use in Rovo:**
   - Open Rovo chat
   - Type a goal like "Build a user authentication system"
   - Provide your project key when asked
   - Done! All issues are created automatically

## Usage Examples

### Basic Examples

**Simple feature:**
```
User: Build a contact form with validation in project WEB
Rovo: ✓ Created 1 epic, 3 stories, 9 subtasks in WEB!
```

**Authentication:**
```
User: I need login, signup, and password reset for project AUTH
Rovo: ✓ Created 2 epics, 6 stories, 18 subtasks in AUTH!
```

**Mobile app:**
```
User: Create a mobile app with user profiles and messaging. Project TEST.
Rovo: ✓ Created 3 epics, 9 stories, 27 subtasks in TEST!
```

### Advanced Examples

**Full-stack project:**
```
User: Build an e-commerce platform with product catalog, shopping cart,
      checkout, payment integration, user accounts, and admin dashboard
      for project ECOM

Rovo: ✓ Created 6 epics, 18 stories, 54 subtasks in ECOM!

      Your plan includes:
      - Planning & Discovery
      - Frontend Development
      - Backend Development
      - Authentication & Security
      - Testing & Quality Assurance
      - Deployment & DevOps
```

**Migration project:**
```
User: Migrate our legacy PHP app to Node.js with React frontend
      and PostgreSQL database in MIGR

Rovo: ✓ Created 5 epics, 15 stories, 45 subtasks in MIGR!
```

## What Gets Created

Every generated plan includes:

### Epics
- Descriptive summaries based on work areas
- Labels for categorization
- Linked to all child stories

### Stories
- Clear, actionable summaries
- Full descriptions
- **Acceptance Criteria** in GIVEN/WHEN/THEN format
- Labels indicating work area
- Linked to parent epic and child subtasks

### Subtasks
- Specific, technical tasks
- Actionable items
- Linked to parent story

### Metadata
- Plan provenance stored on first epic
- Timestamp of generation
- Original goal preserved
- Counts of all created items

## API Reference

### Rovo Action

**Action**: `create-jira-plan`

**Inputs**:
- `projectKey` (required): Jira project key (e.g., PROJ, TEST, DEV)
- `goal` (required): The messy goal description

**Returns**:
```javascript
{
  success: true,
  message: "Successfully created X epics, Y stories, and Z subtasks...",
  summary: {
    projectKey: "PROJ",
    epicCount: 3,
    storyCount: 9,
    subtaskCount: 27,
    epics: [
      { key: "PROJ-1", summary: "Planning & Discovery: ..." },
      { key: "PROJ-10", summary: "Frontend Development: ..." },
      ...
    ],
    firstEpicKey: "PROJ-1"
  }
}
```

### Webtrigger (Alternative Usage)

The app also exposes a webtrigger for external integrations.

**Get URL**: `forge webtrigger`

**Method**: POST

**Payload**:
```json
{
  "projectKey": "PROJ",
  "goal": "Your goal description here",
  "context": {
    "labels": ["optional", "labels"],
    "components": ["Component1"],
    "assignee": "accountId-here"
  }
}
```

## Customization

### Adding New Patterns

Edit `src/index.js` in the `parseGoalIntoPlan()` function:

```javascript
const patterns = {
  frontend: /frontend|ui|interface|design/i,
  backend: /backend|api|server|database/i,
  yourPattern: /your|keywords|here/i,  // Add new pattern
  // ...
};
```

### Modifying Templates

Edit `src/index.js` in the `createEpicForArea()` function to customize:
- Epic names
- Story summaries
- Subtask descriptions
- Acceptance criteria templates

### Adjusting Complexity Threshold

In `parseGoalIntoPlan()`:

```javascript
// Add Planning epic if goal is complex
if (detectedAreas.length > 2 || goal.length > 200) {
  // Change these thresholds ↑
```

## Permissions

Required Jira scopes:
- `read:jira-work` - Read project and issue data
- `write:jira-work` - Create epics, stories, and subtasks

## Troubleshooting

### "Missing required fields"
- Make sure you provide both project key and goal
- Project key should be valid (e.g., PROJ, not proj-123)

### "Failed to create plan"
- Verify you have write permissions to the project
- Check that the project key exists
- Ensure issue types (Epic, Story, Subtask) are enabled in your project

### Agent not responding
- Check app is deployed: `forge deploy --non-interactive -e development`
- Verify app is installed: `forge install list`
- View logs: `forge logs`

### Wrong issue hierarchy
- Some Jira projects require specific configurations for epics
- Ensure your project supports the Epic issue type
- Check that Story and Subtask types exist

## Development

### Run with hot reload:
```bash
forge tunnel
```

### View logs:
```bash
forge logs -e development
```

### Lint code:
```bash
forge lint
```

## Example Conversation Flow

```
User: Hey, I need to build something

Rovo: Sure! I can help you create a structured Jira plan.
      What would you like to build?

User: A payment processing system with Stripe and PayPal support

Rovo: Great! What's your Jira project key?

User: PAY

Rovo: ✓ Done! Created 3 epics, 9 stories, and 27 subtasks in project PAY!

      Your plan includes:
      - Planning & Discovery
      - Backend Development
      - Testing & Quality Assurance

      All tasks are now in your Jira project. You can find them at
      [your-site].atlassian.net/browse/PAY
```

## License

MIT
