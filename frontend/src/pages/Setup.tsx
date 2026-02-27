import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getSetupStatus, createInitialAdmin } from "@/data/setupApi";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertCircle, ShieldCheck } from "lucide-react";

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

export default function SetupPage() {
  const nav = useNavigate();
  const [status, setStatus] = useState<"loading" | "required" | "done" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSetupStatus()
      .then((data) => {
        if (cancelled) return;
        if (data.setupRequired) setStatus("required");
        else setStatus("done");
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus("error");
        setError(getErrorMessage(err));
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (status === "done") {
      nav("/login?setup=done", { replace: true });
    }
  }, [status, nav]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status !== "required" || isSubmitting) return;
    if (!email || !password) {
      setError("Email and password are required");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await createInitialAdmin({ email, password, name: name.trim() || undefined });
      nav("/login?setup=success", { replace: true });
    } catch (err) {
      setError(getErrorMessage(err));
      setIsSubmitting(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  if (status === "done") {
    return null;
  }

  if (status === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Setup unavailable</CardTitle>
            <CardDescription>{error ?? "Could not load setup status."}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Retry
            </Button>
            <Button variant="link" className="ml-2" onClick={() => nav("/login", { replace: true })}>
              Go to login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200 dark:from-slate-950 dark:via-slate-900 dark:to-slate-800 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center mb-2">
            <img src="/n8n_Pulse.svg" alt="n8n Pulse" className="h-16 w-16" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
            n8n Pulse
          </h1>
          <p className="text-muted-foreground text-sm">
            First-run setup — create the initial administrator
          </p>
        </div>

        <Card className="border shadow-xl dark:shadow-2xl dark:shadow-primary/5 backdrop-blur-sm">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Initial admin
            </CardTitle>
            <CardDescription>
              Create the first user account. This step is only available when no users exist.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive" className="py-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label htmlFor="setup-email">Email</Label>
                <Input
                  id="setup-email"
                  type="email"
                  placeholder="admin@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isSubmitting}
                  autoComplete="email"
                  required
                  className="h-11"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="setup-password">Password</Label>
                <PasswordInput
                  id="setup-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isSubmitting}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  className="h-11"
                />
                <p className="text-xs text-muted-foreground">
                  At least 8 characters; avoid common passwords like &quot;password123&quot;.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="setup-name">Name (optional)</Label>
                <Input
                  id="setup-name"
                  type="text"
                  placeholder="Admin"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isSubmitting}
                  autoComplete="name"
                  className="h-11"
                />
              </div>

              <Button
                type="submit"
                className="w-full h-11 font-medium"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create initial admin"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="text-center text-xs text-muted-foreground">
          <a href="/login" className="hover:text-primary transition-colors">
            Already have an account? Sign in
          </a>
        </div>
      </div>
    </div>
  );
}
