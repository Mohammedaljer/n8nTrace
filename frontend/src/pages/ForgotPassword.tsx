import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertCircle, CheckCircle2, ArrowLeft, Copy, Check, Mail } from "lucide-react";
import { getDataConfig } from "@/data/config";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  // Generate the prefilled message for admin
  const adminMessage = `Subject: Password reset request

Hi Admin,

Please generate a password reset link for my account: ${email}

Thanks.`;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;

    if (!email) {
      setError("Email is required");
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError("Please enter a valid email address");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const config = getDataConfig();
      const res = await fetch(`${config.apiBaseUrl}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Request failed");
      }

      setSuccess(true);
    } catch (err) {
      // Always show success to prevent user enumeration
      setSuccess(true);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(adminMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = adminMessage;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
      <div className="w-full max-w-md space-y-6">
        {/* Logo/Header */}
        <div className="text-center space-y-2">
          <img src="/n8n-trace.svg" alt="n8n-trace" className="h-12 w-12 mx-auto mb-2" />
          <h1 className="text-2xl font-bold tracking-tight">n8n-trace</h1>
        </div>

        <Card className="border-0 shadow-lg">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl">Forgot password</CardTitle>
            <CardDescription>
              {success 
                ? "Contact your administrator for a reset link"
                : "Enter your email to request a password reset"
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            {success ? (
              <div className="space-y-4">
                <Alert className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950">
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <AlertDescription className="text-green-800 dark:text-green-200">
                    Your request has been recorded. Please contact your administrator to receive a password reset link.
                  </AlertDescription>
                </Alert>

                {/* Admin message copy section */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <Mail className="h-4 w-4" />
                    <span>Copy this message to send to your admin:</span>
                  </div>
                  
                  <div className="relative">
                    <div className="rounded-md border bg-muted/50 p-3 pr-12 text-sm font-mono whitespace-pre-wrap break-words">
                      {adminMessage}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-2 top-2"
                      onClick={copyToClipboard}
                      data-testid="copy-admin-message-button"
                      aria-label={copied ? "Copied" : "Copy to clipboard"}
                    >
                      {copied ? (
                        <Check className="h-4 w-4 text-green-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>

                  {copied && (
                    <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                      <Check className="h-3 w-3" />
                      Copied to clipboard!
                    </p>
                  )}
                </div>

                <Link to="/login">
                  <Button variant="outline" className="w-full" data-testid="back-to-login-button">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to login
                  </Button>
                </Link>
              </div>
            ) : (
              <form onSubmit={onSubmit} className="space-y-4">
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
                    data-testid="forgot-email-input"
                    className="h-11"
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full h-11"
                  disabled={isSubmitting}
                  data-testid="forgot-submit-button"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    "Request reset link"
                  )}
                </Button>

                <Link to="/login" className="block">
                  <Button variant="ghost" className="w-full">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Back to login
                  </Button>
                </Link>
              </form>
            )}
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground space-x-4">
          <span>&copy; {new Date().getFullYear()} n8n-trace. All rights reserved.</span>
          <a 
            href="https://github.com/Mohammedaljer/n8nTrace" 
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
