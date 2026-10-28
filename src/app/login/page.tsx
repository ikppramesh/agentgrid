export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main style={{ maxWidth: 400, margin: "10vh auto" }}>
      <h1>Sign in to AgentGrid</h1>
      {error && <div className="alert">{error}</div>}
      <div className="card">
        <form className="stack" method="post" action="/api/auth/login">
          <label>Email<input name="email" type="email" autoComplete="username" required /></label>
          <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
          <button type="submit">Sign in</button>
        </form>
      </div>
      <h2>Single sign-on</h2>
      <div className="card">
        <form className="stack" method="get" action="/api/auth/sso/start">
          <label>Organization ID<input name="org" placeholder="acme-agency-x1y2z" required /></label>
          <button className="ghost" type="submit">Continue with SSO</button>
        </form>
      </div>
    </main>
  );
}
