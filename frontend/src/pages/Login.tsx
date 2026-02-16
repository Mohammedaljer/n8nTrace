import { useState, useEffect } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { useAuth } from "@/security/AuthContext";
import { getSetupStatus } from "@/data/setupApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertCircle } from "lucide-react";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    try {
      const parsed = JSON.parse(err.message);
      return parsed.error || err.message;
    } catch {
      return err.message;
    }
  }
  return "Login failed";
}

export default function LoginPage() {
  const nav = useNavigate();
  const { login, state } = useAuth();

  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);
  const setupSuccess = searchParams.get("setup") === "success";

  useEffect(() => {
    getSetupStatus()
      .then((data) => setSetupRequired(data.setupRequired))
      .catch(() => setSetupRequired(null));
  }, []);

  // Redirect if already authenticated
  useEffect(() => {
    if (state.status === "authenticated") {
      nav("/dashboard", { replace: true });
    }
  }, [state.status, nav]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;
    
    if (!email || !password) {
      setError("Email and password are required");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    
    try {
      // Use the new login function that handles session + query invalidation
      await login(email, password);
      // Navigation happens via the useEffect above when state changes to authenticated
      nav("/dashboard", { replace: true });
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      setIsSubmitting(false);
    }
  }

  if (state.status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200 dark:from-slate-950 dark:via-slate-900 dark:to-slate-800 p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo/Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center mb-2">
            <img src="/n8n_Pulse.svg" alt="n8n Pulse" className="h-16 w-16" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
            n8n Pulse
          </h1>
          <p className="text-muted-foreground text-sm">
            Workflow analytics & monitoring dashboard
          </p>
        </div>

        {/* Login Card */}
        <Card className="border shadow-xl dark:shadow-2xl dark:shadow-primary/5 backdrop-blur-sm">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl">Welcome back</CardTitle>
            <CardDescription>
              Enter your credentials to sign in
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              {setupSuccess && (
                <Alert className="py-2 border-green-500/50 bg-green-500/10 text-green-800 dark:text-green-200">
                  <AlertDescription>Initial admin created. Sign in with your new account.</AlertDescription>
                </Alert>
              )}
              {error && (
                <Alert variant="destructive" className="py-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isSubmitting}
                  autoComplete="email"
                  data-testid="login-email-input"
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <PasswordInput
                  id="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isSubmitting}
                  autoComplete="current-password"
                  data-testid="login-password-input"
                  className="h-11"
                />
              </div>

              <Button
                type="submit"
                className="w-full h-11 font-medium"
                disabled={isSubmitting}
                data-testid="login-submit-button"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>

            <div className="mt-4 text-center space-y-2">
              {setupRequired === true && (
                <p className="text-sm text-muted-foreground">
                  No account yet?{" "}
                  <Link to="/setup" className="text-primary hover:underline font-medium" data-testid="setup-link">
                    Run initial setup
                  </Link>
                </p>
              )}
              <Link
                to="/forgot-password"
                className="text-sm text-muted-foreground hover:text-primary transition-colors block"
                data-testid="forgot-password-link"
              >
                Forgot your password?
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground space-x-4">
          <span>&copy; {new Date().getFullYear()} n8n Pulse</span>
          <a 
            href="https://github.com/Mohammedaljer/n8n_dash" 
            target="_blank" 
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
