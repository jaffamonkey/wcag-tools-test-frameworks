// global-teardown.js
import { closeAccessibilityChecker } from "./utils/accessibility";

export default async () => {
  await closeAccessibilityChecker();
};
