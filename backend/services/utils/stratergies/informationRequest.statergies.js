import { tmdbService } from "../../tmdb.service.js";

function truncate(str, max = 500) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max).trim() + "..." : str;
}

function textReply(s) {
  return { text: { text: [String(s)] } };
}

function makeSuggestion(movie, details, posterUrl) {
  return {
    id: movie.id ?? null,
    tmdb_id: movie.id ?? null,
    title: details?.title || details?.name || movie?.title || null,
    poster: posterUrl ?? null,
    rating: details?.vote_average ?? null
  };
}

export async function handleInformationRequest(request) {
  const params = request.parameters || {};

  // =============================
  //  Normalize Input
  // =============================
  const rawParam =
    params.parameter || params.info || params.property || "";
  const rawMovie =
    params.movie_name || params.movie || params.film || null;
  const rawPerson =
    params.person || params.person_name || params.author || null;

  const wanted = String(rawParam).toLowerCase();
  let movieQuery = Array.isArray(rawMovie) ? rawMovie[0] : rawMovie;
  let personQuery = Array.isArray(rawPerson) ? rawPerson[0] : rawPerson;

  // =============================
  //  Try to detect person name from free-form text
  // =============================
  if (!personQuery && rawParam) {
    const txt = String(rawParam).trim();

    let m =
      txt.match(/(?:tiểu\s*sử|ngày\s*sinh|thông\s*tin)\s*(?:của)?\s*(.+)/i) ||
      txt.match(/của\s+(.+)$/i);

    if (m && m[1]) personQuery = m[1].trim();
  }

  // =============================
  //  Intent Detection
  // =============================
  const wantsRating = /điểm|rating|đánh giá|vote/.test(wanted);
  const wantsRelease = /ngày|phát hành|release|năm|ra mắt/.test(wanted);
  const wantsOverview = /tóm tắt|nội dung|mô tả|overview|summary/.test(wanted);
  const wantsCast = /diễn viên|cast|dàn diễn viên/.test(wanted);
  const wantsDirector = /đạo diễn|director/.test(wanted);
  const wantsBiography = /tiểu sử|bio|thông tin/.test(wanted) && !!personQuery;
  const wantsBirth = /ngày sinh|sinh|birth/.test(wanted) && !!personQuery;
  const wantsFilmography = /phim|filmography|đã đóng/.test(wanted) && !!personQuery;

  try {
    // ===============================================
    //  MOVIE MODE
    // ===============================================
    if (movieQuery) {
      const list = await tmdbService.searchMovies(movieQuery);

      if (!list || list.length === 0)
        return {
          fulfillmentMessages: [
            textReply(`Không tìm thấy phim "${movieQuery}".`)
          ]
        };

      const movie = list[0];
      const details = await tmdbService.getMovieDetails(movie.id);

      const posterPath =
        details?.poster_path || movie?.poster_path || null;

      const posterUrl = posterPath
        ? tmdbService.getImageUrl(posterPath, "w500")
        : null;

      const imdbId = details?.external_ids?.imdb_id || details?.imdb_id || null;
      const imdbUrl = imdbId ? `https://www.imdb.com/title/${imdbId}` : null;

      const suggestion = makeSuggestion(movie, details, posterUrl);

      const buildCard = (msg) => ({
        movieCard: {
          id: movie.id,
          poster: posterUrl,
          layout: "image-left",
          // keep title/subtitle as top-level fields and provide a plain-text `text` fallback
          title: details?.title || movie?.title || null,
          subtitle: details?.release_date ? String(details.release_date).slice(0, 4) : null,
          text: String(msg),
          imdbUrl,
          type: "movie"
        },
        text: { text: [msg] }
      });

      //  Rating
      if (wantsRating) {
        const r = details?.vote_average ?? null;
        const msg = r
          ? `Phim "${details.title}" có điểm trung bình ${r}/10.`
          : `Không tìm thấy điểm cho phim "${details.title}".`;

        return {
          fulfillmentMessages: [buildCard(msg)]
        };
      }

      //  Release date
      if (wantsRelease) {
        const rd = details?.release_date;
        const msg = rd
          ? `Phim "${details.title}" phát hành ngày ${rd}.`
          : `Không có thông tin ngày phát hành cho "${details.title}".`;

        return {
          fulfillmentMessages: [buildCard(msg)]
        };
      }

      //  Overview
      if (wantsOverview) {
        const ov = details?.overview;
        const msg = ov
          ? `Tóm tắt phim "${details.title}":\n${truncate(ov, 800)}`
          : `Không có nội dung tóm tắt cho "${details.title}".`;

        return {
          fulfillmentMessages: [buildCard(msg)]
        };
      }

      //  Cast
      if (wantsCast) {
        const cast = details?.credits?.cast?.slice(0, 8) ?? [];
        if (cast.length === 0)
          return {
            fulfillmentMessages: [
              textReply(`Không có diễn viên cho "${details.title}".`)
            ]
          };

        const castNames = cast
          .map((c) => `${c.name}${c.character ? " (vai " + c.character + ")" : ""}`)
          .join(", ");

        const msg = `Dàn diễn viên của "${details.title}": ${castNames}.`;

        return {
          fulfillmentMessages: [buildCard(msg)]
        };
      }

      //  Director
      if (wantsDirector) {
        const directors = details?.credits?.crew
          ?.filter((c) => c.job === "Director")
          ?.map((d) => d.name);

        if (!directors?.length)
          return {
            fulfillmentMessages: [
              textReply(`Không tìm thấy đạo diễn cho "${details.title}".`)
            ]
          };

        const msg = `Đạo diễn của "${details.title}": ${directors.join(", ")}.`;

        return {
          fulfillmentMessages: [buildCard(msg), { movieSuggestions: [suggestion] }]
        };
      }

      //  DEFAULT MOVIE INFO
      const msg =
        `Phim: ${details.title}\n` +
        `Ngày phát hành: ${details.release_date || "Không rõ"}\n` +
        `Điểm: ${details.vote_average}/10\n\n` +
        `${truncate(details.overview, 500)}`;

      return {
        fulfillmentMessages: [buildCard(msg)]
      };
    }

    // ===============================================
    //  PERSON MODE
    // ===============================================
    if (personQuery) {
      const p = await tmdbService.findPersonByName(personQuery);

      if (!p)
        return {
          fulfillmentMessages: [
            textReply(`Không tìm thấy người tên "${personQuery}".`)
          ]
        };

      const details = await tmdbService.getPersonDetails(p.id);

      const profilePath =
        details?.profile_path || p?.profile_path || null;

      const profileUrl = profilePath
        ? tmdbService.getImageUrl(profilePath, "w500")
        : null;

      const birthday = details?.birthday || "Không rõ";
      const birthplace = details?.place_of_birth || "Không rõ";
      const bio = details?.biography || "";

      // GET MOVIE CREDITS
      const credits =
        details?.movie_credits?.cast?.slice(0, 8) ??
        (await tmdbService.getPersonMovieCredits(p.id)).cast?.slice(0, 8) ??
        [];

      const filmSuggestions = credits.map((mv) => {
        const poster = mv.poster_path
          ? tmdbService.getImageUrl(mv.poster_path, "w300")
          : null;
        return makeSuggestion(mv, mv, poster);
      });

      const personImdbId = details?.external_ids?.imdb_id || details?.imdb_id || null;
      const personImdbUrl = personImdbId ? `https://www.imdb.com/name/${personImdbId}` : null;

      const buildCard = (msg) => ({
        personCard: {
          id: p.id,
          poster: profileUrl,
          layout: "image-left",
          title: p.name,
          subtitle: birthday !== "Không rõ" ? birthday : undefined,
          text: String(msg),
          imdbUrl: personImdbUrl,
          type: "person"
        },
        text: { text: [msg] }
      });

      //  Biography
      if (wantsBiography) {
        if (!bio)
          return {
            fulfillmentMessages: [textReply(`Không có tiểu sử cho ${p.name}.`)]
          };

        return {
          fulfillmentMessages: [
            buildCard(`Tiểu sử của ${p.name}: ${truncate(bio, 1000)}`)
          ]
        };
      }

      //  Birth info
      if (wantsBirth) {
        return {
          fulfillmentMessages: [
            buildCard(`${p.name} sinh ngày ${birthday} tại ${birthplace}.`)
          ]
        };
      }

      //  Filmography
      if (wantsFilmography) {
        const titles = credits.map((c) => c.title || c.name).join(", ");
        return {
          fulfillmentMessages: [buildCard(`Một số phim của ${p.name}: ${titles}.`)]
        };
      }

      //  Default person info
      const msg =
        `Tên: ${p.name}\n` +
        `Sinh: ${birthday}\n` +
        `Nơi sinh: ${birthplace}\n\n` +
        `${truncate(bio, 800)}`;

      return {
        fulfillmentMessages: [buildCard(msg)]
      };
    }

    //  FALLBACK
    return {
      fulfillmentMessages: [
        textReply(`Hãy cho mình biết tên *phim* hoặc *diễn viên* bạn muốn tra cứu nhé!`)
      ]
    };
  } catch (err) {
    console.error("handleInformationRequest ERROR:", err);
    return {
      fulfillmentMessages: [
        textReply("Có lỗi xảy ra khi truy vấn TMDB. Thử lại sau nhé!")
      ]
    };
  }
}

export default { handleInformationRequest };
