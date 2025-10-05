// utils/genre.helper.js
export function matchGenre(userGenres, tmdbGenres) {
  if (!Array.isArray(userGenres) || !userGenres.length) return null;

  // --- Normalize function (remove accents, lowercase, remove "phim ") ---
  const normalize = (str) =>
    str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // remove accents
      .replace(/^phim\s+/i, "") // remove "phim "
      .trim();

  // --- Normalize all TMDb genre names ---
  const normalizedGenres = tmdbGenres.map((g) => ({
    ...g,
    normName: normalize(g.name),
  }));

  // console.log("Normalized TMDb genres:", normalizedGenres);

  const matchedGenres = [];

  // --- Try to match each user genre ---
  for (const userGenre of userGenres) {
    const normUser = normalize(userGenre);

    // console.log(
    //   `Trying to match user genre "${userGenre}" (normalized: "${normUser}")`
    // );

    // Exact match
    let match = normalizedGenres.find((g) => g.normName === normUser);

    // Partial match (e.g., "hành động" in "hành động - phiêu lưu")
    if (!match) {
      match = normalizedGenres.find((g) => g.normName.includes(normUser));
    }

    if (match) {
      // console.log("✅ Found match:", match);
      matchedGenres.push(match);
    } else {
      console.log("⚠️ No match found for:", userGenre);
    }
  }

  return matchedGenres;
}
