"use client";

import { useEffect, useMemo, useState } from "react";

type ArchiveLink = {
  type: string;
  url: string;
  search_fallback?: boolean;
};

type Recommendation = {
  id: string;
  date: string;
  section: string;
  category: string;
  title: string | null;
  creator: string | null;
  note: string | null;
  links: ArchiveLink[];
};

const filters = [
  { id: "all", label: "All" },
  { id: "book", label: "Books" },
  { id: "music", label: "Music" },
  { id: "screen", label: "Film & TV" },
  { id: "podcast", label: "Podcasts" },
  { id: "article", label: "Articles" },
  { id: "quote", label: "Quotes" },
  { id: "other", label: "More" },
];

const categoryGroups: Record<string, string[]> = {
  book: ["book", "audiobook"],
  screen: ["video", "tv"],
  article: ["article", "research"],
  other: ["other", "product", "web_video"],
};

const categoryLabels: Record<string, string> = {
  book: "Book",
  audiobook: "Audiobook",
  music: "Music",
  video: "Film",
  tv: "Television",
  web_video: "Web video",
  podcast: "Podcast",
  article: "Article",
  research: "Research",
  quote: "Quote",
  product: "Product",
  other: "Recommendation",
};

function plainText(value = "") {
  return value
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/[*_#>`~\\]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^\s*[—–-]+\s*/, "")
    .trim();
}

function dateLabel(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function primaryLink(item: Recommendation) {
  const order = item.category === "music"
    ? ["spotify_track", "spotify_album"]
    : ["book", "audiobook"].includes(item.category)
      ? ["amazon"]
      : ["video", "tv"].includes(item.category)
        ? ["justwatch"]
        : ["original"];
  for (const type of order) {
    const exact = item.links.find((link) => link.type === type && !link.search_fallback);
    if (exact) return exact;
    const fallback = item.links.find((link) => link.type === type);
    if (fallback) return fallback;
  }
  return item.links.find((link) => link.type === "original") ?? null;
}

function linkLabel(link: ArchiveLink | null) {
  if (!link) return "Open source";
  if (link.type.startsWith("spotify")) return link.search_fallback ? "Search Spotify" : "Play on Spotify";
  if (link.type === "amazon") return link.search_fallback ? "Search Amazon" : "View on Amazon";
  if (link.type === "justwatch") return link.search_fallback ? "Search streaming" : "Find streaming";
  return "Open source";
}

function RecommendationCard({ item }: { item: Recommendation }) {
  const [expanded, setExpanded] = useState(false);
  const note = plainText(item.note ?? "");
  const link = primaryLink(item);
  const canExpand = note.length > 210;

  return (
    <article className={`recommendation-card category-${item.category}`}>
      <div className="card-meta">
        <span className="category-label">{categoryLabels[item.category] ?? "Recommendation"}</span>
        <time dateTime={item.date}>{dateLabel(item.date)}</time>
      </div>
      <p className="section-label">{plainText(item.section)}</p>
      <h2>{plainText(item.title ?? item.section)}</h2>
      {item.creator ? <p className="creator">{plainText(item.creator)}</p> : null}
      {note ? (
        <div className="note-wrap">
          <p className={expanded ? "note expanded" : "note"}>{note}</p>
          {canExpand ? (
            <button className="read-more" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
              {expanded ? "Show less" : "Read Tim’s note"}
            </button>
          ) : null}
        </div>
      ) : null}
      {link ? (
        <a className="destination-link" href={link.url} target="_blank" rel="noreferrer">
          {linkLabel(link)} <span aria-hidden="true">↗</span>
        </a>
      ) : null}
    </article>
  );
}

export function ArchiveApp() {
  const [items, setItems] = useState<Recommendation[]>([]);
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [year, setYear] = useState("all");
  const [visible, setVisible] = useState(36);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/archive-data.json`)
      .then((response) => response.json())
      .then((data: Recommendation[]) => setItems(data.reverse()))
      .finally(() => setLoading(false));
  }, []);

  const years = useMemo(() => [...new Set(items.map((item) => item.date.slice(0, 4)))].sort().reverse(), [items]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const categories = categoryGroups[activeFilter] ?? [activeFilter];
    return items.filter((item) => {
      const matchesCategory = activeFilter === "all" || categories.includes(item.category);
      const matchesYear = year === "all" || item.date.startsWith(year);
      const searchable = `${item.title ?? ""} ${item.creator ?? ""} ${item.section} ${plainText(item.note ?? "")}`.toLowerCase();
      return matchesCategory && matchesYear && (!needle || searchable.includes(needle));
    });
  }, [items, query, activeFilter, year]);

  useEffect(() => setVisible(36), [query, activeFilter, year]);

  return (
    <main>
      <header className="site-header">
        <a href="#top" className="wordmark" aria-label="Five Bullet Index home">
          <span>Five Bullet</span>
          <strong>Index</strong>
        </a>
        <a className="about-link" href="#about">About this archive</a>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Tim Ferriss’s 5-Bullet Friday, organized</p>
          <h1>A library of good ideas, <em>ready to rediscover.</em></h1>
          <p className="intro">Books worth underlining. Music worth replaying. Films worth watching. Thousands of recommendations, searchable in one quiet place.</p>
        </div>
        <div className="archive-stats" aria-label="Archive statistics">
          <div><strong>2,714</strong><span>recommendations</span></div>
          <div><strong>531</strong><span>Friday editions</span></div>
          <div><strong>2015—26</strong><span>years covered</span></div>
        </div>
      </section>

      <section className="archive-shell" aria-label="Recommendation archive">
        <div className="search-row">
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search a title, person, idea…"
              aria-label="Search recommendations"
            />
          </label>
          <label className="year-select">
            <span>Year</span>
            <select value={year} onChange={(event) => setYear(event.target.value)} aria-label="Filter by year">
              <option value="all">All years</option>
              {years.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>

        <nav className="filter-nav" aria-label="Filter recommendations by category">
          {filters.map((filter) => (
            <button
              key={filter.id}
              className={activeFilter === filter.id ? "active" : ""}
              onClick={() => setActiveFilter(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </nav>

        <div className="results-heading">
          <p>{loading ? "Opening the archive…" : `${filtered.length.toLocaleString()} recommendations`}</p>
          {(query || activeFilter !== "all" || year !== "all") ? (
            <button onClick={() => { setQuery(""); setActiveFilter("all"); setYear("all"); }}>Clear filters</button>
          ) : null}
        </div>

        {loading ? (
          <div className="loading-grid" aria-label="Loading recommendations"><i /><i /><i /></div>
        ) : filtered.length ? (
          <>
            <div className="recommendation-grid">
              {filtered.slice(0, visible).map((item) => <RecommendationCard key={item.id} item={item} />)}
            </div>
            {visible < filtered.length ? (
              <button className="load-more" onClick={() => setVisible((count) => count + 36)}>Load more recommendations</button>
            ) : null}
          </>
        ) : (
          <div className="empty-state"><strong>No recommendations found.</strong><span>Try a broader search or another year.</span></div>
        )}
      </section>

      <footer id="about">
        <div>
          <p className="footer-mark">Five Bullet Index</p>
          <p>An independent, searchable index of recommendations from Tim Ferriss’s 5-Bullet Friday newsletter.</p>
        </div>
        <p>Notes are preserved verbatim. Product links are provided for discovery. Not affiliated with Tim Ferriss.</p>
      </footer>
    </main>
  );
}
