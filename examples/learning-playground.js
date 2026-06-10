/*
 * VibeLearner feature playground
 *
 * Each function contains an intentional beginner-level misconception.
 * Do not run this file as production code. Use it to test VibeLearner:
 *
 * 1. Select one function and run "VibeLearner: Ask About Selection".
 * 2. Right-click this file and run "VibeLearner: Ask About File".
 * 3. Try Socratic, Hinted, and Show & Tell modes.
 * 4. Ask for a direct fix and verify that the tutor preserves the learning task.
 * 5. After reasoning about a scenario, use "CFU Quiz" or "Reflect".
 */

// Scenario 1: Off-by-one loop boundary
function printItems(items) {
  for (let index = 0; index <= items.length; index++) {
    console.log(items[index].toUpperCase());
  }
}

// Scenario 2: Variable shadowing
function calculateTotal(prices) {
  let total = 0;

  for (const price of prices) {
    let total = total + price;
    console.log(`Running total: ${total}`);
  }

  return total;
}

// Scenario 3: Async/await sequencing
async function loadUserName(userId) {
  const response = fetch(`https://example.com/users/${userId}`);
  const user = response.json();
  return user.name;
}

// Scenario 4: Missing optional-value handling
function displayStudent(student) {
  return `${student.name}: ${student.course.title.toUpperCase()}`;
}

// Scenario 5: Nested conditionals that obscure the governing rule
function canSubmitAssignment(student, assignment) {
  if (student.isEnrolled) {
    if (!student.isSuspended) {
      if (assignment.isOpen) {
        if (!assignment.isPastDeadline) {
          return true;
        }
      }
    }
  }

  return false;
}

// Keep the examples visible to editors without executing them automatically.
module.exports = {
  printItems,
  calculateTotal,
  loadUserName,
  displayStudent,
  canSubmitAssignment,
};
