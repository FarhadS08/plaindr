interface Company {
  name: string;
  mark: React.ReactNode;
}

const COMPANIES: Company[] = [
  {
    name: "OpenAI",
    mark: (
      <svg viewBox="0 0 40 40" className="w-5 h-5" fill="currentColor">
        <path d="M36.8 16.4a9.8 9.8 0 0 0-.84-8.05 9.92 9.92 0 0 0-10.68-4.76A9.9 9.9 0 0 0 17.8.4 9.9 9.9 0 0 0 8.3 7.2a9.88 9.88 0 0 0-6.6 4.78 9.92 9.92 0 0 0 1.22 11.62 9.8 9.8 0 0 0 .84 8.05 9.92 9.92 0 0 0 10.68 4.76 9.88 9.88 0 0 0 7.46 3.34 9.9 9.9 0 0 0 9.48-6.87 9.88 9.88 0 0 0 6.6-4.78 9.92 9.92 0 0 0-1.18-11.7zM21.9 37.3a7.35 7.35 0 0 1-4.7-1.7l.23-.13 7.77-4.48a1.26 1.26 0 0 0 .64-1.1V19l3.28 1.9a.12.12 0 0 1 .06.09v9.05a7.36 7.36 0 0 1-7.28 7.26zM6.24 30.64a7.34 7.34 0 0 1-.88-4.93l.23.14 7.78 4.48a1.27 1.27 0 0 0 1.28 0l9.5-5.48v3.78a.12.12 0 0 1-.04.1l-7.86 4.53a7.36 7.36 0 0 1-10.01-2.6zM4.2 13.78a7.32 7.32 0 0 1 3.83-3.2v9.2a1.25 1.25 0 0 0 .64 1.1l9.46 5.46-3.28 1.9a.12.12 0 0 1-.12 0L6.86 23.7A7.36 7.36 0 0 1 4.2 13.78zm27 6.28-9.5-5.48 3.28-1.9a.12.12 0 0 1 .12 0l7.88 4.55a7.35 7.35 0 0 1-1.13 13.24v-9.2a1.28 1.28 0 0 0-.65-1.2zm3.27-4.9-.23-.14-7.77-4.48a1.27 1.27 0 0 0-1.28 0l-9.5 5.48v-3.78a.12.12 0 0 1 .04-.1l7.86-4.53a7.35 7.35 0 0 1 10.88 7.55zM14.73 21.8l-3.28-1.9a.12.12 0 0 1-.06-.09V10.82a7.35 7.35 0 0 1 12.05-5.64l-.23.13-7.77 4.48a1.26 1.26 0 0 0-.65 1.1zm1.78-3.84 4.23-2.44 4.23 2.44v4.88l-4.23 2.44-4.23-2.44z" />
      </svg>
    ),
  },
  {
    name: "Anthropic",
    mark: (
      <svg viewBox="0 0 40 40" className="w-5 h-5" fill="currentColor">
        <path d="M13.5 6H8L1 34h5.6l1.5-6.4h7.8L17.4 34H23L16 6zm-4.2 17.4L11.7 13l2.4 10.4zM31.1 6 39 34h-5.5l-7.9-28z" />
      </svg>
    ),
  },
  {
    name: "Google",
    mark: (
      <svg viewBox="0 0 40 40" className="w-5 h-5" fill="currentColor">
        <path d="M20 17.5v4.8h6.7a6.7 6.7 0 0 1-2.8 4.4l4.5 3.5c2.7-2.5 4.2-6.2 4.2-10.6 0-1-.1-2-.3-2.9H20zm-12.1 4.8a11.8 11.8 0 0 1 0-5.6l-4.7-3.7a20 20 0 0 0 0 13l4.7-3.7zm12.1 12a20 20 0 0 0 13.8-5l-4.5-3.5c-1.3.9-3 1.4-5.3 1.4-4 0-7.5-2.7-8.7-6.4l-4.7 3.7c2.3 4.7 7.2 8 13.4 8zm0-27.9c4 0 6.7 1.7 8.2 3.1l3.9-3.9A20 20 0 0 0 20 0C12.8 0 7 4 5.2 9.8l4.7 3.7c1.2-3.7 4.7-6.4 10.1-6.4z" />
      </svg>
    ),
  },
  {
    name: "Microsoft",
    mark: (
      <svg viewBox="0 0 40 40" className="w-5 h-5">
        <path fill="currentColor" d="M4 4h16v16H4zM20 4h16v16H20zM4 20h16v16H4zM20 20h16v16H20z" />
      </svg>
    ),
  },
  {
    name: "Vercel",
    mark: (
      <svg viewBox="0 0 40 40" className="w-5 h-5" fill="currentColor">
        <path d="M20 4 38 34H2z" />
      </svg>
    ),
  },
  {
    name: "HubSpot",
    mark: (
      <svg viewBox="0 0 40 40" className="w-5 h-5" fill="currentColor">
        <path d="M29 16.7V11a4 4 0 1 0-4 0v5.7a10.8 10.8 0 0 0-5 2.1L5.6 7.9 4 10l14.2 10.6a10.9 10.9 0 1 0 10.8-3.9zm-1.8 16.4a5.6 5.6 0 1 1 5.6-5.6 5.6 5.6 0 0 1-5.6 5.6z" />
      </svg>
    ),
  },
];

export function CompanyMarks() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4 sm:gap-x-12">
      {COMPANIES.map((c) => (
        <div
          key={c.name}
          className="flex items-center gap-2 text-muted-foreground/70 hover:text-foreground transition-colors"
        >
          <span className="opacity-70">{c.mark}</span>
          <span className="text-sm font-medium tracking-tight">{c.name}</span>
        </div>
      ))}
    </div>
  );
}
