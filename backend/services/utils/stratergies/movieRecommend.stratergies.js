import { tmdbService } from "../../tmdb.service.js";
import { findPerson } from "../person.js";
import { matchGenre } from "../genre.js";
import { parseRatingFilter } from "../rating.js";
import { extractYear, normalizeDateComparator, filterMoviesByYear } from "../date.js";

// Helper: compute small and large ranges for before/after year queries
function computeYearRanges(year, comparator, comparatorToken) {
  const now = new Date().getFullYear();
  if (comparatorToken && /mới|hiện/i.test(String(comparatorToken))) {
    if (!year || typeof year !== 'number') {
      return { smallRange: [Math.max(now - 1, 1900), now], largeRange: [Math.max(now - 4, 1900), now] };
    }
    return { smallRange: [year + 1, year + 2], largeRange: [year + 1, year + 5] };
  }

  // If comparatorToken indicates 'old' then pick older-than windows
  if (comparatorToken && /cũ|lâu|xưa|hoài/i.test(String(comparatorToken))) {
    if (!year || typeof year !== 'number') {
      return { smallRange: [1900, Math.max(now - 20, 1900)], largeRange: [1900, Math.max(now - 50, 1900)] };
    }
    return { smallRange: [1900, Math.max(year - 20, 1900)], largeRange: [1900, Math.max(year - 50, 1900)] };
  }

  if (!year || typeof year !== 'number') return { exact: year };
  if (comparator === '<') {
    const smallStart = Math.max(year - 5, 1900);
    const smallEnd = year - 1;
    const largeStart = Math.max(year - 20, 1900);
    const largeEnd = year - 1;
    return { smallRange: [smallStart, smallEnd], largeRange: [largeStart, largeEnd] };
  }
  if (comparator === '>') {
    const smallStart = year + 1;
    const smallEnd = year + 5;
    const largeStart = year + 1;
    const largeEnd = year + 20;
    return { smallRange: [smallStart, smallEnd], largeRange: [largeStart, largeEnd] };
  }
  return { exact: year };
}

// Compute a single primary range [start, end] based on inputs.
// Preference: if explicit year range provided -> use it.
// If single year provided -> return [year, year].
// If comparator present with a numeric year or comparator-only, use computeYearRanges and prefer smallRange.
function computePrimaryRange(releaseYear, comparator, comparatorToken) {
  // explicit range
  if (Array.isArray(releaseYear) && releaseYear.length >= 2) return [releaseYear[0], releaseYear[1]];
  // exact year
  if (typeof releaseYear === 'number') return [releaseYear, releaseYear];

  // no explicit year: try comparator/comparatorToken
  const cmp = normalizeDateComparator(comparator || comparatorToken || 'none');
  const ranges = computeYearRanges(releaseYear, cmp, comparatorToken);
  if (!ranges) return null;
  if (ranges.smallRange) return ranges.smallRange;
  if (ranges.largeRange) return ranges.largeRange;
  if (ranges.exact) return typeof ranges.exact === 'number' ? [ranges.exact, ranges.exact] : null;
  return null;
}

const movieMap = new Map(); // id -> movie object

// We'll collect per-person movie id sets separated by actor/director roles
const perPersonSets = []; // [{ name, actorSet: Set, directorSet: Set, associatedSet: Set }]
const movieDetails = new Map(); // id -> sample movie details seen in credits

/**
 * Handles movie recommendation by persons/genres/rating
 * - Accepts a list of person names (person, persons, people)
 * - If at least one of (persons, genres, rating) is present, performs search
 * - If none provided, returns a polite message asking for more info
 */
export async function handleMovieRecommendation(request) {
  const params = request.parameters || {};

  console.log("Parameters:", params);

  // (keep only top-level Parameters log above)

  // --- Normalize params ---
  const rawPersons = params.persons || params.person || params.people || [];

  // Normalize persons into an array of name strings. Dialogflow may return:
  // - a single string
  // - an array of strings
  // - an array of structs like [{ name: 'Robert De Niro' }]
  // - a single struct { name: 'Robert De Niro' }
  let persons = [];
  if (Array.isArray(rawPersons)) {
    // flatten any nested arrays and coerce each entry into a string name when possible
    persons = rawPersons
      .flat(Infinity)
      .map((item) => {
        if (!item && item !== 0) return null;
        if (typeof item === "string") return item.trim();
        if (typeof item === "number") return String(item);
        if (typeof item === "object") {
          if (typeof item.name === "string") return item.name.trim();
          if (typeof item.value === "string") return item.value.trim();
          // previously decoded struct from Dialogflow might already be simplified
          // otherwise fallback to JSON string (rare)
          return item.toString ? item.toString() : null;
        }
        return null;
      })
      .filter(Boolean);
  } else if (typeof rawPersons === "string") {
    persons = [rawPersons.trim()];
  } else if (rawPersons && typeof rawPersons === "object") {
    if (typeof rawPersons.name === "string") persons = [rawPersons.name.trim()];
    else if (typeof rawPersons.value === "string") persons = [rawPersons.value.trim()];
  }

  const rawGenres = params.genre || params.genres || [];
  const genres = Array.isArray(rawGenres)
    ? rawGenres.flat().filter(Boolean)
    : typeof rawGenres === "string"
      ? [rawGenres]
      : [];

  // --- Normalize date/year/comparator params ---
  // Support multiple possible parameter names coming from Dialogflow
  const rawYearInput = params.release_year || params.year || params.date || params.releaseYear || params.year_value || params.date_value || params.publish_date || params.publishDate || params.published_year || params.publish_year || params.publishYear || null;
  let releaseYear = null;
  if (Array.isArray(rawYearInput)) {
    // try to extract numeric years from each entry
    const arr = rawYearInput.map((r) => extractYear(r)).filter((y) => typeof y === 'number');
    if (arr.length >= 2) releaseYear = [arr[0], arr[1]];
    else if (arr.length === 1) releaseYear = arr[0];
  } else {
    releaseYear = extractYear(rawYearInput);
  }

  // comparators / tokens: allow both explicit comparator and raw token like 'mới'/'cũ'
  const dateComparator = params.date_comparator || params.comparator || params.dateComparator || null;
  const rawComparator = params.raw_comparator || params.comparator_token || params.rawComparator || params.comparatorToken || null;

  // Compute primary range early so discover logic can use it (avoids undefined primaryRangeForDiscover)
  const cmpForRange = normalizeDateComparator(dateComparator || rawComparator);
  const primaryRange = computePrimaryRange(releaseYear, cmpForRange, rawComparator);
  const primaryRangeForDiscover = primaryRange;

  // --- Detect rating param (if any) and log comparator/value for debugging ---
  let ratingFilter = null;
  try {
    ratingFilter = parseRatingFilter(params);
  } catch (e) {
    // ignore parse errors
  }
  // If user explicitly supplied a publish_date (or alias), allow movies missing release_date to be kept
  const allowUnknownYear = Boolean(params.publish_date || params.publishDate || params.published_year || params.publish_year || params.publishYear);
  // ratingFilter parsed (or not) — no extra debug logs
  // Compute a single primary range (start,end) to use across discovers/filters.
  // Preference: if user supplied an exact year -> [year,year]; if two-year range -> that range.
  // If comparator-based ranges exist, prefer the 'smallRange' and fall back to 'largeRange'.
  // --- Require at least one meaningful criterion ---
  // allow releaseYear-only queries or comparator-only (rawComparator like 'cũ'/'mới') as a valid criterion
  const hasComparatorOnly = !!rawComparator && !releaseYear;
  if (!persons.length && !genres.length && !releaseYear && !hasComparatorOnly) {
    return {
      fulfillmentMessages: [
        {
          text: {
            text: [
              "Mình cần ít nhất một tiêu chí để gợi ý phim: tên diễn viên/đạo diễn, thể loại, hoặc điểm (ví dụ: 'phim có Robert De Niro', 'phim hành động', 'phim điểm > 7').",
            ],
          },
        },
      ],
    };
  }

  // --- Prepare genre matching if genres were provided ---
  const tmdbGenres = await tmdbService.getGenres();
  let matchedGenres = [];
  let matchedGenreIds = [];
  if (genres.length) {
    matchedGenres = matchGenre(genres, tmdbGenres) || [];
    if (!matchedGenres.length) {
      return {
        fulfillmentMessages: [
          {
            text: {
              text: [`Xin lỗi, tôi không nhận diện được thể loại "${genres.join(", ")}". Bạn có thể thử hành động, hài, kinh dị, lãng mạn...`],
            },
          },
        ],
      };
    }
    matchedGenreIds = matchedGenres.map((g) => g.id);
  }

  const MAX_SUGGESTIONS = 8;
  const MAX_POOL = 24; // cap for internal pool and to stop further fetching

  // --- If persons provided, resolve them and collect movie credits (role-aware) ---
  const personNotFound = [];
  const foundPersons = [];
  // local movieMap (id -> movie)
  const movieMapLocal = new Map();

  // per-person role sets
  const perPersonSetsLocal = []; // { id, name, actorSet: Set, directorSet: Set }

  if (persons.length) {
    for (const name of persons) {
      try {
        // Use the improved resolver which prefers exact normalized name, also_known_as and acting dept
        const top = await findPerson(name);
        if (!top) {
          personNotFound.push(name);
          continue;
        }

        const resolvedName = top.name || top.original_name || name;
        foundPersons.push({ id: top.id, name: resolvedName });

        // get credits (cast + crew)
        const credits = await tmdbService.getPersonMovieCredits(top.id);
        const cast = credits && Array.isArray(credits.cast) ? credits.cast : [];
        const crew = credits && Array.isArray(credits.crew) ? credits.crew : [];

        const actorSet = new Set();
        const directorSet = new Set();

        // record cast entries
        for (const c of cast) {
          if (!c || !c.id) continue;
          actorSet.add(c.id);
          if (!movieMapLocal.has(c.id)) {
            movieMapLocal.set(c.id, {
              id: c.id,
              title: c.title || c.original_title || c.name || "",
              poster_path: c.poster_path,
              release_date: c.release_date || c.first_air_date || null,
              genre_ids: c.genre_ids || [],
              vote_average: c.vote_average,
              popularity: c.popularity || 0,
            });
          }
        }

        // record crew entries, but only mark director role when job === 'Director'
        for (const d of crew) {
          if (!d || !d.id) continue;
          if (d.job && typeof d.job === "string" && d.job.toLowerCase() === "director") {
            directorSet.add(d.id);
          }
          if (!movieMapLocal.has(d.id)) {
            movieMapLocal.set(d.id, {
              id: d.id,
              title: d.title || d.original_title || d.name || "",
              poster_path: d.poster_path,
              release_date: d.release_date || d.first_air_date || null,
              genre_ids: d.genre_ids || [],
              vote_average: d.vote_average,
              popularity: d.popularity || 0,
            });
          }
        }

        perPersonSetsLocal.push({ id: top.id, name: top.name || top.original_name || name, actorSet, directorSet });
      } catch (err) {
        console.warn("Error resolving person", name, err);
        personNotFound.push(name);
      }
    }
  }

  // debug: how many movies collected from persons
  // movieMapLocal size and person counts are available but not logged here

  // --- If no persons but genres/rating then fall back to discover by genre ---
  if (!movieMapLocal.size && matchedGenreIds.length) {
    // Use discover for each matched genre and collect
    for (const gid of matchedGenreIds) {
      try {
        let movies = [];
        const cmp = normalizeDateComparator(dateComparator);
        const primaryRangeForDiscover = primaryRange;

        if (ratingFilter) {
          // numeric year + comparator -> prefer small/large ranges
          if ((cmp === '<' || cmp === '>') && typeof releaseYear === 'number') {
            const ranges = computeYearRanges(releaseYear, cmp, rawComparator);
            console.log('[RangeDebug][genre] releaseYear=', releaseYear, 'cmp=', cmp, 'smallRange=', ranges.smallRange, 'largeRange=', ranges.largeRange);
            if (ranges.smallRange) {
              movies = await tmdbService.discoverMoviesByRating(ratingFilter.value, ratingFilter.comparator, { genreId: gid, maxResults: 50, releaseYearRange: ranges.smallRange });
              if ((!movies || movies.length < 8) && ranges.largeRange) {
                const more = await tmdbService.discoverMoviesByRating(ratingFilter.value, ratingFilter.comparator, { genreId: gid, maxResults: 50, releaseYearRange: ranges.largeRange });
                movies = movies.concat(more || []);
              }
            }
          }

          // fallback to primaryRange then to no-year discover
          if ((!movies || movies.length === 0) && primaryRangeForDiscover) {
            movies = await tmdbService.discoverMoviesByRating(ratingFilter.value, ratingFilter.comparator, { genreId: gid, maxResults: 50, releaseYearRange: primaryRangeForDiscover });
          }
          if ((!movies || movies.length === 0)) {
            movies = await tmdbService.discoverMoviesByRating(ratingFilter.value, ratingFilter.comparator, { genreId: gid, maxResults: 50 });
          }

        } else if (Array.isArray(releaseYear)) {
          movies = await tmdbService.discoverMoviesByYear(undefined, releaseYear, { genreId: gid, maxResults: 50 });

        } else if (releaseYear) {
          if ((cmp === '<' || cmp === '>') && typeof releaseYear === 'number') {
            const ranges = computeYearRanges(releaseYear, cmp, rawComparator);
            console.log('[RangeDebug][genre] releaseYear=', releaseYear, 'cmp=', cmp, 'smallRange=', ranges.smallRange, 'largeRange=', ranges.largeRange);
            if (ranges.smallRange) {
              movies = await tmdbService.discoverMoviesByYear(undefined, ranges.smallRange, { genreId: gid, maxResults: 50 });
              if ((!movies || movies.length < 8) && ranges.largeRange) {
                const more = await tmdbService.discoverMoviesByYear(undefined, ranges.largeRange, { genreId: gid, maxResults: 50 });
                movies = movies.concat(more || []);
              }
            }
          }

          if ((!movies || movies.length === 0) && primaryRangeForDiscover) {
            movies = await tmdbService.discoverMoviesByYear(undefined, primaryRangeForDiscover, { genreId: gid, maxResults: 50 });
          }

          if ((!movies || movies.length === 0)) {
            movies = movies || (Array.isArray(releaseYear)
              ? await tmdbService.discoverMoviesByYear(undefined, releaseYear, { genreId: gid, maxResults: 50 })
              : await tmdbService.discoverMoviesByYear(releaseYear, undefined, { genreId: gid, maxResults: 50 }));
          }

        } else {
          // no releaseYear/ratingFilter: try primaryRange then fallback to genre discover
          if (primaryRangeForDiscover) {
            movies = await tmdbService.discoverMoviesByYear(undefined, primaryRangeForDiscover, { genreId: gid, maxResults: 50 });
          } else {
            movies = await tmdbService.discoverMoviesByGenre(gid);
          }
        }

        for (const m of movies) {
          if (!m || !m.id) continue;
          if (!m.release_date && m.first_air_date) m.release_date = m.first_air_date;
          if (!movieMapLocal.has(m.id)) movieMapLocal.set(m.id, m);
          if (movieMapLocal.size >= MAX_POOL) break;
        }
        if (movieMapLocal.size >= MAX_POOL) break;
      } catch (err) {
        console.warn("Error discovering by genre", gid, err);
      }
    }
  }

  // If no persons and no genres but we have a releaseYear filter or comparator-only (e.g., 'cũ'/'mới'), discover by year
  if (!movieMapLocal.size && !matchedGenreIds.length && (releaseYear || rawComparator)) {
    try {
      let movies = [];
      // Handle comparators for year-only queries
      let comparator = dateComparator;
      if (["trước", "cũ", "lâu", "hoài", "xưa", "sớm hơn"].includes(comparator)) comparator = "<";
      if (["sau", "mới", "gần đây", "vừa ra mắt", "trở đi"].includes(comparator)) comparator = ">";

      // Compute primaryRange (prefer smallRange then largeRange) and use it for discovers
      const primaryRangeForDiscover = primaryRange;

      if (comparator === "<" && typeof releaseYear === "number") {
        // Range: (year-5) to (year-1)
        let start = releaseYear - 5;
        let end = releaseYear - 1;
        movies = await tmdbService.discoverMoviesByYear(undefined, [start, end], { maxResults: 50 });
        if (movies.length < 8) {
          // Expand to (year-20) to (year-1)
          start = releaseYear - 20;
          movies = await tmdbService.discoverMoviesByYear(undefined, [start, end], { maxResults: 50 });
        }
      } else if (comparator === ">" && typeof releaseYear === "number") {
        // Range: (year+1) to (year+5)
        let start = releaseYear + 1;
        let end = releaseYear + 5;
        movies = await tmdbService.discoverMoviesByYear(undefined, [start, end], { maxResults: 50 });
        if (movies.length < 8) {
          // Expand to (year+1) to (year+20)
          end = releaseYear + 20;
          movies = await tmdbService.discoverMoviesByYear(undefined, [start, end], { maxResults: 50 });
        }
      } else if (Array.isArray(releaseYear)) {
        movies = await tmdbService.discoverMoviesByYear(undefined, releaseYear, { maxResults: 50 });
      } else if (primaryRangeForDiscover) {
        movies = await tmdbService.discoverMoviesByYear(undefined, primaryRangeForDiscover, { maxResults: 50 });
      } else {
        movies = await tmdbService.discoverMoviesByYear(releaseYear, undefined, { maxResults: 50 });
      }
      for (const m of movies) {
        if (!m || !m.id) continue;
        if (!m.release_date && m.first_air_date) m.release_date = m.first_air_date;
        if (!movieMapLocal.has(m.id)) movieMapLocal.set(m.id, m);
        if (movieMapLocal.size >= MAX_POOL) break;
      }
    } catch (err) {
      console.warn('Error discovering by year', err);
    }
  }

  // --- Build unions for actor/director across all provided persons ---
  const actorUnionSet = new Set();
  const directorUnionSet = new Set();
  for (const p of perPersonSetsLocal) {
    for (const id of p.actorSet) actorUnionSet.add(id);
    for (const id of p.directorSet) directorUnionSet.add(id);
  }

  // When persons are provided we should only augment with movies related to those persons.
  const allowedPersonMovieIds = new Set([...actorUnionSet, ...directorUnionSet]);

  // Build candidates using per-person role constraints (AND across persons):
  // - For each provided person, if they have actor credits require the movie to include them.
  // - If they have director credits require the movie to be directed by them.
  // - If they have both, allow either role.
  let candidates = [];

  const movieMatchesAllPersonConstraints = (movieId) => {
    if (!perPersonSetsLocal.length) return true;
    for (const p of perPersonSetsLocal) {
      const hasActor = p.actorSet && p.actorSet.size > 0;
      const hasDirector = p.directorSet && p.directorSet.size > 0;
      if (hasActor && !hasDirector) {
        if (!p.actorSet.has(movieId)) return false;
      } else if (hasDirector && !hasActor) {
        if (!p.directorSet.has(movieId)) return false;
      } else if (hasActor && hasDirector) {
        if (!p.actorSet.has(movieId) && !p.directorSet.has(movieId)) return false;
      } else {
        // person had no actor/director credits — do not constrain
        continue;
      }
    }
    return true;
  };

  if (perPersonSetsLocal.length) {
    for (const [id, m] of movieMapLocal.entries()) {
      if (movieMatchesAllPersonConstraints(id)) candidates.push(m);
    }
    // tighten allowedPersonMovieIds to the actual candidate ids
    allowedPersonMovieIds.clear();
    for (const c of candidates) if (c && c.id) allowedPersonMovieIds.add(c.id);
  } else {
    candidates = Array.from(movieMapLocal.values());
  }

  // assign back to movieMap used later logic
  // (we keep variable name movieMap to be consistent with subsequent code)
  movieMap.clear();
  for (const [k, v] of movieMapLocal.entries()) movieMap.set(k, v);

  // If we still have zero candidates but genres were provided and persons were supplied, fallback to per-person+genre discover
  if ((!candidates || candidates.length === 0) && matchedGenreIds.length && perPersonSetsLocal.length) {
    const perGenreCollected = [];
    const seen = new Set();
    const MAX_CANDIDATES = MAX_POOL;
    for (const gid of matchedGenreIds) {
      for (const p of perPersonSetsLocal) {
        // try discover by person + genre
        try {
          let movies = [];
          const cmp = normalizeDateComparator(dateComparator);
          const primaryRangeForDiscover = primaryRange;
          // rating-based discovery (with optional year ranges)
          if (ratingFilter) {
            if ((cmp === '<' || cmp === '>') && typeof releaseYear === 'number') {
              const ranges = computeYearRanges(releaseYear, cmp, rawComparator);
              if (ranges.smallRange) {
                movies = await tmdbService.discoverMoviesByRating(ratingFilter.value, ratingFilter.comparator, { genreId: gid, personId: p.id, maxResults: 50, releaseYearRange: ranges.smallRange });
                if ((!movies || movies.length < 8) && ranges.largeRange) {
                  const more = await tmdbService.discoverMoviesByRating(ratingFilter.value, ratingFilter.comparator, { genreId: gid, personId: p.id, maxResults: 50, releaseYearRange: ranges.largeRange });
                  movies = movies.concat(more || []);
                }
              } else if (primaryRangeForDiscover) {
                movies = await tmdbService.discoverMoviesByRating(ratingFilter.value, ratingFilter.comparator, { genreId: gid, personId: p.id, maxResults: 50, releaseYearRange: primaryRangeForDiscover });
              } else {
                movies = await tmdbService.discoverMoviesByRating(ratingFilter.value, ratingFilter.comparator, { genreId: gid, personId: p.id, maxResults: 50 });
              }
            } else if (Array.isArray(releaseYear)) {
              movies = await tmdbService.discoverMoviesByRating(ratingFilter.value, ratingFilter.comparator, { genreId: gid, personId: p.id, maxResults: 50, releaseYearRange: releaseYear });
            } else if (releaseYear) {
              movies = await tmdbService.discoverMoviesByRating(ratingFilter.value, ratingFilter.comparator, { genreId: gid, personId: p.id, maxResults: 50, releaseYear });
            } else if (primaryRangeForDiscover) {
              movies = await tmdbService.discoverMoviesByRating(ratingFilter.value, ratingFilter.comparator, { genreId: gid, personId: p.id, maxResults: 50, releaseYearRange: primaryRangeForDiscover });
            } else {
              movies = await tmdbService.discoverMoviesByRating(ratingFilter.value, ratingFilter.comparator, { genreId: gid, personId: p.id, maxResults: 50 });
            }
          } else if (releaseYear) {
            // year-based discovery
            if ((cmp === '<' || cmp === '>') && typeof releaseYear === 'number') {
              const ranges = computeYearRanges(releaseYear, cmp, rawComparator);
              if (ranges.smallRange) {
                movies = await tmdbService.discoverMoviesByYear(undefined, ranges.smallRange, { personId: p.id, genreId: gid, maxResults: 50 });
                if ((!movies || movies.length < 8) && ranges.largeRange) {
                  const more = await tmdbService.discoverMoviesByYear(undefined, ranges.largeRange, { personId: p.id, genreId: gid, maxResults: 50 });
                  movies = movies.concat(more || []);
                }
              }
            }
            if ((!movies || movies.length === 0) && primaryRangeForDiscover) {
              movies = await tmdbService.discoverMoviesByYear(undefined, primaryRangeForDiscover, { personId: p.id, genreId: gid, maxResults: 50 });
            }
            if ((!movies || movies.length === 0)) {
              movies = movies || (Array.isArray(releaseYear)
                ? await tmdbService.discoverMoviesByYear(undefined, releaseYear, { personId: p.id, genreId: gid, maxResults: 50 })
                : await tmdbService.discoverMoviesByYear(releaseYear, undefined, { personId: p.id, genreId: gid, maxResults: 50 }));
            }
          } else if (primaryRangeForDiscover) {
            movies = await tmdbService.discoverMoviesByYear(undefined, primaryRangeForDiscover, { personId: p.id, genreId: gid, maxResults: 50 });
          } else {
            // final fallback: person+genre discover
            movies = await tmdbService.discoverMoviesByPersonAndGenre(p.id, gid, 50);
          }
          for (const mv of movies) {
            if (!mv || !mv.id) continue;
            if (!mv.release_date && mv.first_air_date) mv.release_date = mv.first_air_date;
            if (!seen.has(mv.id)) {
              perGenreCollected.push(mv);
              seen.add(mv.id);
            }
            if (perGenreCollected.length >= MAX_CANDIDATES) break;
          }
        } catch (err) {
          // ignore individual failures
          console.warn("discoverMoviesByPersonAndGenre failed for", p.id, gid, err);
        }
        if (perGenreCollected.length >= MAX_CANDIDATES) break;
      }
      if (perGenreCollected.length >= MAX_CANDIDATES) break;
    }
    candidates = perGenreCollected;
    // also add these discovered ids to allowedPersonMovieIds so augmentation can include them
    for (const mv of perGenreCollected) {
      if (mv && mv.id) allowedPersonMovieIds.add(mv.id);
    }
  }

  // --- Convert candidates/map to array and apply genre/rating filters if needed ---
  if (!candidates || candidates.length === 0) {
    candidates = Array.from(movieMap.values());
  }

  // rating-only discovery removed

  // If we have persons/genres but very few candidates, augment pool using top-rated/popular and discover by rating
  const MIN_POOL = 20;
  if ((persons.length || genres.length) && candidates.length < MIN_POOL) {
    try {
      // try top rated
      if (ratingFilter) {
        const personIds = foundPersons && foundPersons.length ? foundPersons.map(p => p.id).join(',') : undefined;
        const opts = Object.assign({ maxResults: MAX_POOL }, personIds ? { personId: personIds } : {});
        if (releaseYear) {
          if (Array.isArray(releaseYear)) opts.releaseYearRange = releaseYear;
          else opts.releaseYear = releaseYear;
        }
        const byRating = await tmdbService.discoverMoviesByRating(ratingFilter.value, ratingFilter.comparator, opts);
        for (const m of byRating) {
          if (!m || !m.id) continue;
          if (persons.length && !allowedPersonMovieIds.has(m.id)) continue;
          if (!m.release_date && m.first_air_date) m.release_date = m.first_air_date;
          candidates.push({ id: m.id, title: m.title || m.original_title || m.name || "", poster_path: m.poster_path, release_date: m.release_date || null, genre_ids: m.genre_ids || [], vote_average: m.vote_average, popularity: m.popularity || 0 });
          if (candidates.length >= MAX_POOL) break;
        }
      } else {
        const top = await tmdbService.getTopRatedMovies();
        if (Array.isArray(top)) {
          for (const m of top) {
            if (!m || !m.id) continue;
            if (persons.length && !allowedPersonMovieIds.has(m.id)) continue;
            if (!m.release_date && m.first_air_date) m.release_date = m.first_air_date;
            candidates.push({ id: m.id, title: m.title || m.original_title || m.name || "", poster_path: m.poster_path, release_date: m.release_date || null, genre_ids: m.genre_ids || [], vote_average: m.vote_average, popularity: m.popularity || 0 });
            if (candidates.length >= MAX_POOL) break;
          }
        }
      }
    } catch (e) {
      /* ignore */
    }
    // rating-based augmentation removed
    // also try popular
    try {
      // For popular augmentation, if rating filter exists try rating-based discover with no genre/person
      if (ratingFilter && candidates.length < MAX_POOL) {
        const byRatingOpts = { maxResults: MAX_POOL };
        if (releaseYear) {
          if (Array.isArray(releaseYear)) byRatingOpts.releaseYearRange = releaseYear;
          else byRatingOpts.releaseYear = releaseYear;
        }
        const byRating = await tmdbService.discoverMoviesByRating(ratingFilter.value, ratingFilter.comparator, byRatingOpts);
        for (const m of byRating) {
          if (!m || !m.id) continue;
          if (persons.length && !allowedPersonMovieIds.has(m.id)) continue;
          if (!m.release_date && m.first_air_date) m.release_date = m.first_air_date;
          candidates.push({ id: m.id, title: m.title || m.original_title || m.name || "", poster_path: m.poster_path, release_date: m.release_date || null, genre_ids: m.genre_ids || [], vote_average: m.vote_average, popularity: m.popularity || 0 });
          if (candidates.length >= MAX_POOL) break;
        }
      }
      if (candidates.length < MAX_POOL) {
        const pop = await tmdbService.getPopularMovies();
        if (Array.isArray(pop)) {
          for (const m of pop) {
            if (!m || !m.id) continue;
            if (persons.length && !allowedPersonMovieIds.has(m.id)) continue;
            candidates.push({ id: m.id, title: m.title || m.original_title || m.name || "", poster_path: m.poster_path, release_date: m.release_date || m.first_air_date || null, genre_ids: m.genre_ids || [], vote_average: m.vote_average, popularity: m.popularity || 0 });
            if (candidates.length >= MAX_POOL) break;
          }
        }
      }
    } catch (e) {
      /* ignore */
    }
  }

  // dedupe candidates by id and keep latest
  if (candidates && candidates.length) {
    const dedup = new Map();
    for (const m of candidates) {
      if (!m || !m.id) continue;
      dedup.set(m.id, Object.assign(dedup.get(m.id) || {}, m));
    }
    candidates = Array.from(dedup.values());

  }

  // If still not enough candidates, try fetching additional discover pages
  if (candidates.length < MAX_SUGGESTIONS) {

    const extra = [];
    const PAGES_TO_TRY = 12; // try up to 10 pages to collect more results
    for (let page = 1; page <= PAGES_TO_TRY && candidates.length + extra.length < MAX_POOL; page++) {
      try {
        let endpoint = '/discover/movie?';
        const parts = [];
        // prefer genre if available
        if (matchedGenreIds.length) parts.push(`with_genres=${matchedGenreIds.join(',')}`);
        // if persons provided, prefer discover results scoped to those people
        if (foundPersons && foundPersons.length) parts.push(`with_people=${foundPersons.map(p => p.id).join(',')}`);
        // include rating filter in path when present
        if (ratingFilter && typeof ratingFilter.value === 'number') {
          const eps = 0.01;
          const comp = (ratingFilter.comparator || '').toLowerCase();
          const v = Number(ratingFilter.value);
          if (comp === 'gte') parts.push(`vote_average.gte=${encodeURIComponent(v)}`);
          else if (comp === 'gt') parts.push(`vote_average.gte=${encodeURIComponent(Number((v + eps).toFixed(2)))}`);
          else if (comp === 'lte') parts.push(`vote_average.lte=${encodeURIComponent(v)}`);
          else if (comp === 'lt') parts.push(`vote_average.lte=${encodeURIComponent(Number((v - eps).toFixed(2)))}`);
          else if (comp === 'eq') {
            parts.push(`vote_average.gte=${encodeURIComponent(Number((v - eps).toFixed(2)))}`);
            parts.push(`vote_average.lte=${encodeURIComponent(Number((v + eps).toFixed(2)))}`);
          } else {
            parts.push(`vote_average.gte=${encodeURIComponent(v)}`);
          }
        }
        parts.push('sort_by=popularity.desc');
        parts.push(`page=${page}`);
        endpoint += parts.join('&');
        const data = await tmdbService.fetchFromTMDb(endpoint);
        const results = (data && data.results) || [];
        for (const m of results) {
          if (!m || !m.id) continue;
          // if persons provided, only include discovered results that are related to those persons
          if (persons.length && !allowedPersonMovieIds.has(m.id)) continue;
          extra.push({ id: m.id, title: m.title || m.original_title || m.name || '', poster_path: m.poster_path, release_date: m.release_date || m.first_air_date || null, genre_ids: m.genre_ids || [], vote_average: m.vote_average, popularity: m.popularity || 0 });
          if (candidates.length + extra.length >= MAX_POOL) break;
        }

      } catch (e) {
        console.warn('discover extra page failed', e);
      }
    }
    // merge extras and dedupe again
    if (extra.length) {
      const merged = new Map(candidates.map((m) => [m.id, m]));
      for (const m of extra) {
        merged.set(m.id, Object.assign(merged.get(m.id) || {}, m));
        if (merged.size >= MAX_POOL) break;
      }
      candidates = Array.from(merged.values()).slice(0, MAX_POOL);

    }
  }

  // Final fallback: if still not enough, append top-rated/popular (optionally filter by genre)
  if (candidates.length < MAX_SUGGESTIONS) {
    try {
      const top = await tmdbService.getTopRatedMovies();
      for (const m of top) {
        if (!m || !m.id) continue;
        if (matchedGenreIds.length) {
          const gids = m.genre_ids || [];
          if (!gids.some((id) => matchedGenreIds.includes(id))) continue;
        }
        if (persons.length && !allowedPersonMovieIds.has(m.id)) continue;
        candidates.push({ id: m.id, title: m.title || m.original_title || m.name || '', poster_path: m.poster_path, release_date: m.release_date || m.first_air_date || null, genre_ids: m.genre_ids || [], vote_average: m.vote_average, popularity: m.popularity || 0 });
      }
    } catch (e) {
      // ignore
    }
  }

  if (candidates.length < MAX_SUGGESTIONS) {
    try {
      const pop = await tmdbService.getPopularMovies();
      for (const m of pop) {
        if (!m || !m.id) continue;
        if (matchedGenreIds.length) {
          const gids = m.genre_ids || [];
          if (!gids.some((id) => matchedGenreIds.includes(id))) continue;
        }
        if (persons.length && !allowedPersonMovieIds.has(m.id)) continue;
        if (!m.release_date && m.first_air_date) m.release_date = m.first_air_date;
        candidates.push({ id: m.id, title: m.title || m.original_title || m.name || '', poster_path: m.poster_path, release_date: m.release_date || null, genre_ids: m.genre_ids || [], vote_average: m.vote_average, popularity: m.popularity || 0 });
      }
    } catch (e) {
      // ignore
    }
  }

  if (matchedGenreIds.length) {
    candidates = candidates.filter((m) => {
      const gids = m.genre_ids || [];
      return gids.some((id) => matchedGenreIds.includes(id));
    });

  }

  // Ensure vote_average present: fetch details for candidates missing it (limited)
  if (candidates && candidates.length) {
    const missing = candidates.filter((m) => typeof m.vote_average !== 'number' || Number.isNaN(m.vote_average));

    if (missing.length) {
      const MAX_DETAIL_FETCH = 40;
      const toFetch = missing.slice(0, MAX_DETAIL_FETCH);
      await Promise.all(
        toFetch.map(async (m) => {
          try {
            const details = await tmdbService.getMovieDetails(m.id);
            if (details && typeof details.vote_average === 'number') m.vote_average = details.vote_average;
            else if (details && details.data && typeof details.data.vote_average === 'number') m.vote_average = details.data.vote_average;
          } catch (e) {
            // ignore
          }
        })
      );

    }
  }

  // If a rating filter was provided, apply it now (we fetched missing vote_average above)
  if (ratingFilter && typeof ratingFilter.value === 'number') {
    const v = ratingFilter.value;
    const comp = (ratingFilter.comparator || '').toLowerCase();
    const before = candidates.length;
    candidates = candidates.filter((m) => {
      const rv = typeof m.vote_average === 'number' ? m.vote_average : (m.vote_average && typeof m.vote_average === 'string' ? Number(m.vote_average) : NaN);
      if (Number.isNaN(rv)) return false;
      if (comp === 'gte') return rv >= v;
      if (comp === 'gt') return rv > v;
      if (comp === 'lte') return rv <= v;
      if (comp === 'lt') return rv < v;
      // default equality (allow small epsilon)
      return Math.abs(rv - v) < 1e-6;
    });

  }

  // If a releaseYear/comparator-based constraint exists, prefer applying a single primaryRange
  // filter to the candidate list (reduce repeated per-candidate checks).
  // primaryRange was computed earlier as either [start,end] or null.
  if (primaryRange && Array.isArray(primaryRange) && primaryRange.length === 2) {
    console.log('[RangeDebug][primaryRange] using primaryRange=', primaryRange);

    // Try to fill missing release_date fields for better filtering (limit to avoid excessive requests)
    const missingDate = candidates.filter((m) => !m.release_date);
    if (missingDate.length) {
      const MAX_FILL = 40;
      const toFetch = missingDate.slice(0, MAX_FILL);
      await Promise.all(
        toFetch.map(async (m) => {
          try {
            const details = await tmdbService.getMovieDetails(m.id);
            if (details && details.release_date) m.release_date = details.release_date;
            else if (details && details.data && details.data.release_date) m.release_date = details.data.release_date;
          } catch (e) {
            // ignore fetch failures
          }
        })
      );
    }

    // Apply a single between-range filter once for all candidates
    candidates = filterMoviesByYear(candidates, 'between', primaryRange, allowUnknownYear);
  } else if (releaseYear) {
    // Fallback: if no primaryRange computed, use legacy comparator handling (keeps current behavior)
    let comparator = dateComparator;
    if (["trước", "cũ", "lâu", "hoài", "xưa", "sớm hơn"].includes(comparator)) comparator = "<";
    if (["sau", "mới", "gần đây", "vừa ra mắt", "trở đi"].includes(comparator)) comparator = ">";
    candidates = filterMoviesByYear(candidates, comparator, releaseYear, allowUnknownYear);
  } else if (!releaseYear && rawComparator) {
    // Still support comparator-only tokens when primaryRange couldn't be computed (rare)
    const cmp = normalizeDateComparator(rawComparator || dateComparator);
    const ranges = computeYearRanges(null, cmp, rawComparator);
    if (ranges) console.log('[RangeDebug][comparator-only] rawComparator=', rawComparator, 'cmp=', cmp, 'smallRange=', ranges.smallRange, 'largeRange=', ranges.largeRange);

    const missingDate = candidates.filter((m) => !m.release_date);
    if (missingDate.length) {
      const MAX_FILL = 40;
      const toFetch = missingDate.slice(0, MAX_FILL);
      await Promise.all(
        toFetch.map(async (m) => {
          try {
            const details = await tmdbService.getMovieDetails(m.id);
            if (details && details.release_date) m.release_date = details.release_date;
            else if (details && details.data && details.data.release_date) m.release_date = details.data.release_date;
          } catch (e) {
            // ignore fetch failures
          }
        })
      );
    }

    let filtered = [];
    if (ranges && ranges.smallRange) filtered = filterMoviesByYear(candidates, 'between', ranges.smallRange, allowUnknownYear);
    if ((!filtered || filtered.length === 0) && ranges && ranges.largeRange) {
      const filteredLarge = filterMoviesByYear(candidates, 'between', ranges.largeRange, allowUnknownYear);
      if (filteredLarge && filteredLarge.length) filtered = filteredLarge;
    }
    if (filtered && filtered.length) candidates = filtered;
  }

  // --- Sort and take top suggestions ---
  // Shuffle candidates to provide diversity, then cap pool to 24 and pick MAX_SUGGESTIONS from it.
  const shuffleArray = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  };

  // Shuffle in-place a copy to avoid mutating upstream arrays unexpectedly
  let pool = candidates && candidates.length ? shuffleArray([...candidates]) : [];
  if (pool.length > MAX_POOL) pool = pool.slice(0, MAX_POOL);

  const suggestions = (pool.slice(0, MAX_SUGGESTIONS) || []).map((m) => ({
    id: m.id,
    title: m.title,
    poster: tmdbService.getImageUrl(m.poster_path),
    rating: m.vote_average,
    release_date: m.release_date || m.first_air_date || null,
  }));

  // --- Build messages ---
  const headerParts = [];
  if (foundPersons.length) headerParts.push(`liên quan tới ${foundPersons.map((p) => p.name).join(", ")}`);
  if (matchedGenres.length) headerParts.push(`${matchedGenres.map((g) => g.name).join(", ")}`);
  if (releaseYear) {
    if (Array.isArray(releaseYear)) {
      headerParts.push(`năm ${releaseYear[0]}-${releaseYear[1]}`);
    } else {
      headerParts.push(`năm ${releaseYear}`);
    }
  }
  if (ratingFilter && typeof ratingFilter.value === 'number') {
    const comp = (ratingFilter.comparator || '').toLowerCase();
    let compText = '';
    if (comp === 'gte') compText = 'trở lên';
    else if (comp === 'gt') compText = 'lớn hơn';
    else if (comp === 'lte') compText = 'trở xuống';
    else if (comp === 'lt') compText = 'nhỏ hơn';
    else if (comp === 'eq') compText = '';
    else compText = 'trở lên';
    headerParts.push(`điểm đánh giá ${compText} ${ratingFilter.value}`.trim());
  }
  // rating header removed

  const header = headerParts.length
    ? `🎬 Gợi ý phim ${headerParts.join(" - ")}:\n\n`
    : `🎬 Gợi ý phim:\n\n`;

  if (!suggestions.length) {
    const reason = personNotFound.length ? `Không tìm thấy thông tin cho: ${personNotFound.join(", ")}.` : "Không tìm thấy phim phù hợp.";
    return {
      fulfillmentMessages: [
        { text: { text: [reason] } },
      ],
    };
  }

  // Debug: print final suggestions (title + id + year or 'unknown')
  try {
    for (const s of suggestions) {
      let year = 'unknown';
      try {
        let rd = null;
        if (s && (s.release_date || s.first_air_date)) rd = s.release_date || s.first_air_date;
        if (!rd && movieMap && movieMap.get) {
          const details = movieMap.get(s.id);
          if (details) rd = details.release_date || details.first_air_date || null;
        }
        if (rd) {
          const y = new Date(rd).getFullYear();
          if (!Number.isNaN(y)) year = y;
        }
      } catch (ee) {
        // ignore
      }
    }
  } catch (e) {
    /* ignore logging errors */
  }

  return {
    fulfillmentMessages: [
      { text: { text: [header] } },
      { movieSuggestions: suggestions },
    ],
  };
}

export default { handleMovieRecommendation };
