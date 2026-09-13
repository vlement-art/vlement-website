import { defineCollection, z } from 'astro:content';

// Every artwork is one Markdown file in src/content/artworks/.
// The filename (minus .md) becomes the URL slug, e.g. sad-bunny.md -> /work/sad-bunny
// The Markdown body (below the --- frontmatter ---) is the full description
// shown on the artwork page; the `summary` field is the short version used
// on cards and in metadata (e.g. Open Graph description).
const artworks = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    year: z.number().int(),
    medium: z.string(),
    dimensions: z.string(),
    category: z.string(),
    collection: z.string(),
    summary: z.string(),
    // Path relative to /public, e.g. /images/artwork/sad-bunny.webp
    image: z.string(),
    // Path relative to /public, e.g. /images/thumbnails/sad-bunny.webp
    thumbnail: z.string(),
    altText: z.string(),
    featured: z.boolean().default(false),
    available: z.boolean().default(true),
    price: z.string().optional(),
    displayOrder: z.number().int().default(0),
  }),
});

export const collections = { artworks };
