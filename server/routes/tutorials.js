const router = require('express').Router();
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// In-memory cache for search results with 1-hour TTL
const searchCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Curated collection of high quality crochet patterns and tutorials
const CURATED_TUTORIALS = [
  {
    id: 'aAxhuCR3Bqc',
    title: 'How to Crochet for Absolute Beginners: Step by Step Tutorial',
    channelTitle: 'Bella Coco',
    description: 'Learn the absolute basics of crochet including slip knot, chain stitch, and single crochet with clear slow demonstrations.',
    thumbnail: 'https://images.unsplash.com/photo-1584992236310-6edddc08acff?auto=format&fit=crop&w=640&q=80',
    publishedAt: '2023-01-15T10:00:00Z',
    category: 'Beginner Basics',
  },
  {
    id: 'p298Hxecf1o',
    title: 'How to Make a Magic Ring (Magic Circle) in Crochet',
    channelTitle: 'TL Yarn Crafts',
    description: 'The foolproof method for starting amigurumi, granny squares, and circular crochet projects with a magic ring.',
    thumbnail: 'https://images.unsplash.com/photo-1606760227091-3dd870d97f1d?auto=format&fit=crop&w=640&q=80',
    publishedAt: '2023-03-20T14:30:00Z',
    category: 'Beginner Basics',
  },
  {
    id: 'f_Q0F55p7tM',
    title: 'Classic Granny Square Tutorial for Beginners',
    channelTitle: 'Simply Daisy',
    description: 'Step-by-step easy classic granny square. Learn cluster stitches, corners, and how to change colors seamlessly.',
    thumbnail: 'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?auto=format&fit=crop&w=640&q=80',
    publishedAt: '2023-02-10T12:00:00Z',
    category: 'Granny Square',
  },
  {
    id: 'E3bKjY7wQoo',
    title: 'Sunburst / Sunflower Granny Square Crochet Tutorial',
    channelTitle: 'Nautikrall Crochet',
    description: 'Learn how to make the viral sunburst granny square using puff stitches and cluster stitches.',
    thumbnail: 'https://images.unsplash.com/photo-1528459801416-a9e53bbf4e17?auto=format&fit=crop&w=640&q=80',
    publishedAt: '2023-05-18T09:15:00Z',
    category: 'Granny Square',
  },
  {
    id: '2H7Lz8g1YfM',
    title: 'No-Sew Crochet Mini Whale Amigurumi Tutorial',
    channelTitle: 'All From Jade',
    description: 'A super fast 20-minute no-sew amigurumi project for beginners and craft fairs. Low yarn usage and cute results.',
    thumbnail: 'https://images.unsplash.com/photo-1582234372722-50d7ccc30ebd?auto=format&fit=crop&w=640&q=80',
    publishedAt: '2023-04-05T16:00:00Z',
    category: 'Amigurumi',
  },
  {
    id: 'j4Vn6k9QwLo',
    title: 'Crochet Teddy Bear Amigurumi Pattern Walkthrough',
    channelTitle: 'Rose and Lily Crochet',
    description: 'Complete amigurumi tutorial for a soft teddy bear, detailing shaping, safety eye insertion, and limb attachment.',
    thumbnail: 'https://images.unsplash.com/photo-1517457373958-b7bdd4587205?auto=format&fit=crop&w=640&q=80',
    publishedAt: '2023-06-22T11:45:00Z',
    category: 'Amigurumi',
  },
  {
    id: '7L_qj1kR8wY',
    title: 'Beginner Hexagon Cardigan: The Easiest Crochet Sweater',
    channelTitle: 'PassioKnit Kenzie',
    description: 'Make a full cardigan using only two crocheted hexagons! Perfect for beginners wanting to make their first wearable.',
    thumbnail: 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?auto=format&fit=crop&w=640&q=80',
    publishedAt: '2023-07-14T15:20:00Z',
    category: 'Wearables / Cardigans',
  },
  {
    id: '8vKj9LmQ1sW',
    title: 'Crochet Bucket Hat: Trendy Checkered & Solid Styles',
    channelTitle: 'Brunical Crochet',
    description: 'Easy summer bucket hat pattern with head measurement guide and brim tension tips.',
    thumbnail: 'https://images.unsplash.com/photo-1534215754734-18e55d13e346?auto=format&fit=crop&w=640&q=80',
    publishedAt: '2023-08-01T13:10:00Z',
    category: 'Wearables / Cardigans',
  },
  {
    id: '9YmK2jP5tRe',
    title: 'How to Crochet the Waffle Stitch (Textured Blankets & Bags)',
    channelTitle: 'Rich Textures Crochet',
    description: 'Master the waffle stitch with front post double crochet stitches. Creates thick, squishy, and beautiful texture.',
    thumbnail: 'https://images.unsplash.com/photo-1584992236310-6edddc08acff?auto=format&fit=crop&w=640&q=80',
    publishedAt: '2023-09-11T08:00:00Z',
    category: 'Stitch Tutorials',
  },
  {
    id: '4LmP9xQ2vWc',
    title: 'Alpine Stitch Tutorial: Gorgeous Diamond Texture',
    channelTitle: 'Hopeful Honey',
    description: 'The alpine stitch creates a dense, non-holey fabric perfect for potholders, winter hats, and structured totes.',
    thumbnail: 'https://images.unsplash.com/photo-1606760227091-3dd870d97f1d?auto=format&fit=crop&w=640&q=80',
    publishedAt: '2023-10-04T17:30:00Z',
    category: 'Stitch Tutorials',
  },
  {
    id: '5KpW8jQ1sRo',
    title: 'Crochet 3D Layered Rose Flower Pattern',
    channelTitle: 'HappyBerry Crochet',
    description: 'Quick crochet flowers to embellish hats, hair clips, bags, and baby garments.',
    thumbnail: 'https://images.unsplash.com/photo-1528459801416-a9e53bbf4e17?auto=format&fit=crop&w=640&q=80',
    publishedAt: '2023-11-19T10:15:00Z',
    category: 'Flowers & Motifs',
  },
  {
    id: '3XzM1vQ8kPw',
    title: 'Easy Daisy Flower Coasters (Set of 4 Pattern)',
    channelTitle: 'KnitcroAddict',
    description: 'Fast gift item for craft fairs and holiday orders. Daisy flower coasters worked in cotton yarn.',
    thumbnail: 'https://images.unsplash.com/photo-1598440947619-2c35fc9aa908?auto=format&fit=crop&w=640&q=80',
    publishedAt: '2023-12-05T12:00:00Z',
    category: 'Flowers & Motifs',
  },
];

const CATEGORIES = [
  'All',
  'Beginner Basics',
  'Amigurumi',
  'Granny Square',
  'Wearables / Cardigans',
  'Stitch Tutorials',
  'Flowers & Motifs',
];

// GET /api/tutorials/categories
router.get('/categories', (req, res) => {
  res.json(CATEGORIES);
});

// GET /api/tutorials/search
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  const category = (req.query.category || '').trim();
  const apiKey = process.env.YOUTUBE_API_KEY;

  const cacheKey = `${q.toLowerCase()}|${category.toLowerCase()}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return res.json(cached.data);
  }

  // If YouTube API Key is available, try official API
  if (apiKey) {
    try {
      const parts = ['crochet'];
      if (category && category !== 'All') parts.push(category);
      if (q) parts.push(q);
      const searchQuery = parts.join(' ');

      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=24&q=${encodeURIComponent(searchQuery)}&key=${apiKey}`;
      const response = await fetch(url);

      if (response.ok) {
        const data = await response.json();
        const items = (data.items || []).map((item) => ({
          id: item.id?.videoId,
          title: item.snippet?.title,
          channelTitle: item.snippet?.channelTitle,
          description: item.snippet?.description,
          thumbnail:
            item.snippet?.thumbnails?.high?.url ||
            item.snippet?.thumbnails?.medium?.url ||
            item.snippet?.thumbnails?.default?.url ||
            `https://img.youtube.com/vi/${item.id?.videoId}/hqdefault.jpg`,
          publishedAt: item.snippet?.publishedAt,
          category: category && category !== 'All' ? category : 'Crochet Tutorial',
        })).filter(it => it.id);

        const result = {
          configured: true,
          source: 'youtube_api',
          items,
        };

        searchCache.set(cacheKey, { timestamp: Date.now(), data: result });
        return res.json(result);
      } else {
        console.warn(`YouTube API returned HTTP ${response.status}. Falling back to curated tutorials.`);
      }
    } catch (err) {
      console.warn('YouTube API request failed, falling back to curated collection:', err.message);
    }
  }

  // Graceful fallback: Curated collection filtered locally
  let filtered = CURATED_TUTORIALS;

  if (category && category !== 'All') {
    filtered = filtered.filter(
      (item) => item.category.toLowerCase() === category.toLowerCase()
    );
  }

  if (q) {
    const qLower = q.toLowerCase();
    filtered = filtered.filter(
      (item) =>
        item.title.toLowerCase().includes(qLower) ||
        item.description.toLowerCase().includes(qLower) ||
        item.channelTitle.toLowerCase().includes(qLower) ||
        item.category.toLowerCase().includes(qLower)
    );
  }

  const result = {
    configured: Boolean(apiKey),
    source: 'curated',
    items: filtered,
  };

  searchCache.set(cacheKey, { timestamp: Date.now(), data: result });
  res.json(result);
});

module.exports = router;
