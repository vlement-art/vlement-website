// Edit this file to update the artist's name, contact details and social
// links across the whole site — every page imports from here.
export const site = {
  artistName: 'Vlement J. Rodrigues',
  shortName: 'Vlement',
  domain: 'vlement.com',
  url: 'https://vlement.com', // EDIT ME if your domain changes
  tagline: 'Original paintings and limited edition prints',
  description:
    'Original paintings, mixed-media works and limited edition prints by London artist Vlement J. Rodrigues.',
  location: 'London, UK',
  email: 'sales@vlement.com', // EDIT ME
  social: {
    instagram: {
      handle: 'Vlement_art',
      url: 'https://instagram.com/Vlement_art',
    },
  },
  // Shown in the footer and on the privacy page.
  copyrightYear: new Date().getFullYear(),
} as const;
