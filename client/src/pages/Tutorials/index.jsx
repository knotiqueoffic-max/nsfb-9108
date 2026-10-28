import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../api/index';

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-violet-200 border-t-violet-600 rounded-full animate-spin" />
    </div>
  );
}

const CATEGORIES = [
  'All',
  'Beginner Basics',
  'Amigurumi',
  'Granny Square',
  'Wearables / Cardigans',
  'Stitch Tutorials',
  'Flowers & Motifs',
];

export default function Tutorials() {
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [activeVideo, setActiveVideo] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['tutorials', selectedCategory, activeQuery],
    queryFn: () =>
      api
        .get('/tutorials/search', {
          params: {
            category: selectedCategory === 'All' ? '' : selectedCategory,
            q: activeQuery,
          },
        })
        .then((r) => r.data),
  });

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setActiveQuery(searchQuery.trim());
  };

  const handleCategoryClick = (cat) => {
    setSelectedCategory(cat);
  };

  const items = data?.items || [];
  const isLiveApi = data?.source === 'youtube_api';
  const isConfigured = data?.configured;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Crochet Pattern Finder & Tutorials</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Discover stitches, video walkthroughs, amigurumi guides, and project inspiration directly within Knotique
          </p>
        </div>

        {/* API Badge indicator */}
        <div className="flex items-center gap-2">
          {isLiveApi ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Live YouTube Data API
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
              🧶 Curated Crochet Library
            </span>
          )}
        </div>
      </div>

      {/* Info Banner when API key is not present */}
      {!isConfigured && (
        <div className="p-3.5 bg-gradient-to-r from-violet-50 to-indigo-50 border border-violet-200 rounded-2xl flex items-center justify-between flex-wrap gap-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-base">💡</span>
            <span className="text-slate-700">
              Browsing hand-picked crochet masterclasses and patterns. To search all of YouTube live, set{' '}
              <code className="bg-white px-1.5 py-0.5 rounded border border-violet-200 text-violet-800 font-mono">
                YOUTUBE_API_KEY
              </code>{' '}
              in your environment.
            </span>
          </div>
        </div>
      )}

      {/* Search Bar & Quick Categories */}
      <div className="card p-5 space-y-4">
        <form onSubmit={handleSearchSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
              🔍
            </span>
            <input
              type="text"
              placeholder="Search crochet patterns, stitches (e.g. waffle stitch, bucket hat, baby blanket)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input pl-10 text-sm"
            />
          </div>
          <button type="submit" className="btn-primary px-5 text-sm shrink-0">
            Search
          </button>
          {activeQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setActiveQuery('');
              }}
              className="btn-secondary px-3 text-sm shrink-0"
            >
              Clear
            </button>
          )}
        </form>

        {/* Category Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          {CATEGORIES.map((cat) => {
            const isSelected = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => handleCategoryClick(cat)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all ${
                  isSelected
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* Video Results Grid */}
      {isLoading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <div className="card text-center py-16">
          <p className="text-4xl mb-3">🔍</p>
          <p className="font-semibold text-slate-700">No tutorials found</p>
          <p className="text-xs text-slate-400 mt-1">Try another search term or pick a different category.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {items.map((video) => (
            <div
              key={video.id}
              className="card p-0 overflow-hidden hover:shadow-lg transition-all group border-slate-200 flex flex-col justify-between"
            >
              {/* Thumbnail with hover play overlay */}
              <div
                onClick={() => setActiveVideo(video)}
                className="relative aspect-video bg-slate-100 overflow-hidden cursor-pointer"
              >
                <img
                  src={video.thumbnail}
                  alt={video.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-slate-900/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <div className="w-12 h-12 rounded-full bg-violet-600/90 text-white flex items-center justify-center text-xl shadow-lg pl-0.5 transform group-hover:scale-110 transition-transform">
                    ▶
                  </div>
                </div>
                {video.category && (
                  <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-900/80 text-white backdrop-blur-sm">
                    {video.category}
                  </span>
                )}
              </div>

              {/* Video Info */}
              <div className="p-4 flex flex-col justify-between flex-1">
                <div>
                  <h3
                    onClick={() => setActiveVideo(video)}
                    className="font-bold text-slate-800 text-sm line-clamp-2 cursor-pointer hover:text-violet-600 transition-colors"
                    title={video.title}
                  >
                    {video.title}
                  </h3>
                  <p className="text-xs text-violet-700 font-medium mt-1">{video.channelTitle}</p>
                  {video.description && (
                    <p className="text-xs text-slate-500 line-clamp-2 mt-2" title={video.description}>
                      {video.description}
                    </p>
                  )}
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <button
                    onClick={() => setActiveVideo(video)}
                    className="btn-primary btn-sm flex-1 py-1.5 text-xs bg-violet-600 hover:bg-violet-700"
                  >
                    ▶ Watch Video
                  </button>
                  <a
                    href={`https://www.youtube.com/watch?v=${video.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-secondary btn-sm p-1.5 text-xs text-slate-600 hover:text-slate-900"
                    title="Open on YouTube"
                  >
                    ↗️
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Embedded Video Modal */}
      {activeVideo && (
        <div
          onClick={() => setActiveVideo(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden max-h-[92vh] flex flex-col"
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-100 bg-white">
              <div className="truncate pr-4">
                <h3 className="font-bold text-slate-800 text-base truncate">{activeVideo.title}</h3>
                <p className="text-xs text-violet-700 font-medium">{activeVideo.channelTitle}</p>
              </div>
              <button
                onClick={() => setActiveVideo(null)}
                className="btn-ghost btn-sm rounded-full w-8 h-8 p-0 flex items-center justify-center text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            {/* Embed Video Iframe */}
            <div className="relative aspect-video w-full bg-black">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${activeVideo.id}?autoplay=1&rel=0`}
                title={activeVideo.title}
                className="w-full h-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>

            {/* Video Details & External Link */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between flex-wrap gap-3 text-xs">
              <p className="text-slate-600 line-clamp-2 max-w-2xl">{activeVideo.description}</p>
              <a
                href={`https://www.youtube.com/watch?v=${activeVideo.id}`}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary btn-sm py-1.5 px-3 text-xs font-semibold shrink-0"
              >
                Open in YouTube ↗️
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
