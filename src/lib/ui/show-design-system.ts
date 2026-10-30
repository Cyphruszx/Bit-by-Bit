/**
 * The design-system preview is for local work. Production builds do not link to it.
 * Read `NODE_ENV` directly so the client bundle can inline it. Passing `process.env`
 * through a parameter leaves the client with an empty object.
 */
export function showDesignSystem(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return nodeEnv !== "production";
}
