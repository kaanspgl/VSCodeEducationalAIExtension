/*
 * VibeLearner feature playground
 *
 * Each function contains an intentional beginner-level misconception.
 * Do not run this file as production code. Use it to test VibeLearner:
 *
 * 1. Select one function and run "VibeLearner: Explain Selection" (Ctrl+Alt+E).
 * 2. Select a function, run "VibeLearner: Change Selection…" and ask for a fix;
 *    in Guided mode, follow the walkthrough, prediction, check and "your turn".
 * 3. Call a scenario at the bottom of the file, press "▶ Run", and use
 *    "Explain this error" when it crashes.
 * 4. Switch the Learning level (Guided / Light / Off) in the header to compare.
 * 5. Open "Your progress" and try "Quiz me on my program".
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
