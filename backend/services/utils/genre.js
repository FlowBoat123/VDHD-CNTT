// utils/genre.helper.js
export function matchGenre(userGenres, tmdbGenres) {
  if (!Array.isArray(userGenres) || !userGenres.length) {
    console.log("lỗi");
    return null;
  }

  userGenres = userGenres.flat();

  // --- Normalize function (remove accents, lowercase, remove "phim ") ---
  const normalize = (str) => {
    if (typeof str !== "string") {
      console.warn("normalize() expected string but got:", str);
      return "";
    }
    return str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // remove accents
      .replace(/^phim\s+/i, "") // remove "phim "
      .trim();
  };

  // --- Normalize all TMDb genre names ---
  const normalizedGenres = tmdbGenres.map((g) => ({
    ...g,
    normName: normalize(g.name),
  }));

  const matchedGenres = [];

  // --- Try to match each user genre ---
  for (const userGenre of userGenres) {
    console.log(userGenre);
    const normUser = normalize(userGenre);
    console.log("Available genres:", normalizedGenres.map((g) => g.normName));

    // Exact match
    let match = normalizedGenres.find((g) => g.normName === normUser);

    // Partial match (e.g., "hành động" in "hành động - phiêu lưu")
    if (!match) {
      match = normalizedGenres.find((g) => g.normName.includes(normUser));
    }

    if (match) {
      matchedGenres.push(match);
    } else {
      console.log("⚠️ No match found for:", userGenre);
    }
  }

  return matchedGenres;
}
