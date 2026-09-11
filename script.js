(() => {
  const body = document.body;
  const themeToggle = document.getElementById("themeToggle");
  const searchInput = document.getElementById("searchInput");
  const collectionFilter = document.getElementById("collectionFilter");
  const cards = [...document.querySelectorAll(".artwork-card")];
  const resultCount = document.getElementById("resultCount");
  const emptyState = document.getElementById("emptyState");
  const lightbox = document.getElementById("lightbox");
  const lightboxImage = document.getElementById("lightboxImage");
  const lightboxCaption = document.getElementById("lightboxCaption");
  const lightboxClose = document.getElementById("lightboxClose");

  function updateThemeLabel() {
    const dark = body.classList.contains("is-dark");
    themeToggle.textContent = dark ? "Light mode" : "Dark mode";
    themeToggle.setAttribute("aria-pressed", String(dark));
  }

  themeToggle.addEventListener("click", () => {
    body.classList.toggle("is-dark");
    updateThemeLabel();
  });

  function filterCards() {
    const query = searchInput.value.trim().toLowerCase();
    const collection = collectionFilter.value;
    let visible = 0;

    cards.forEach((card) => {
      const title = card.dataset.title.toLowerCase();
      const medium = card.dataset.medium.toLowerCase();
      const coll = card.dataset.collection.toLowerCase();
      const matchesQuery = !query || title.includes(query) || medium.includes(query) || coll.includes(query);
      const matchesCollection = collection === "all" || card.dataset.collection === collection;
      const show = matchesQuery && matchesCollection;

      card.style.display = show ? "" : "none";
      if (show) visible += 1;
    });

    resultCount.textContent = `${visible} ${visible === 1 ? "work" : "works"}`;
    emptyState.style.display = visible ? "none" : "block";
  }

  searchInput.addEventListener("input", filterCards);
  collectionFilter.addEventListener("change", filterCards);
  filterCards();

  function closeLightbox() {
    if (lightbox.open) lightbox.close();
    lightboxImage.src = "";
  }

  document.querySelectorAll(".artwork-image-button").forEach((button) => {
    button.addEventListener("click", () => {
      lightboxImage.src = button.dataset.image;
      lightboxImage.alt = button.dataset.alt;
      lightboxCaption.textContent = button.dataset.title;
      lightbox.showModal();
    });
  });

  lightboxClose.addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) closeLightbox();
  });
  lightbox.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeLightbox();
  });

  document.querySelectorAll(".artwork-image").forEach((image) => {
    image.addEventListener("error", () => {
      const card = image.closest(".artwork-card");
      if (card) card.style.display = "none";
      filterCards();
    });
  });
})();
