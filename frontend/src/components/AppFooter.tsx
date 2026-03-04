export function AppFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t bg-card/50 px-6 py-4">
      <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <p>© {year} n8n-trace. All rights reserved.</p>
        <a 
          href="https://github.com/Mohammedaljer/n8nTrace" 
          target="_blank" 
          rel="noopener noreferrer"
          className="hover:text-foreground transition-colors"
        >
          GitHub
        </a>
      </div>
    </footer>
  );
}
