// Fixture mini qa-verify — exists so the integrity check can discover which
// npm scripts the battery names (the ["run", "<name>"] pattern below).
const commands = [
  { name: "unit-tests", command: "npm", args: ["run", "test:run"] },
  { name: "browser-e2e-tests", command: "npm", args: ["run", "test:e2e"] },
  { name: "lint", command: "npm", args: ["run", "lint"] },
  { name: "production-build", command: "npm", args: ["run", "build"] },
];
console.log(`battery: ${commands.length} command(s)`);
