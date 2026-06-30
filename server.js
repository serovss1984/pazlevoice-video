require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const session = require('express-session');
const path = require('path');

const app = express();
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

const requireAuth = (req, res, next) => {
    if (req.session.admin) return next();
    res.redirect('/admin/login');
};

function slugify(text) {
    if (!text) return '' + Date.now();
    return text.toLowerCase()
        .replace(/[^a-z\u0430-\u044f\u04510-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 100);
}

// === OMDb API ===
async function fetchOmdbData(imdbId) {
    const apiKey = process.env.OMDB_API_KEY;
    if (!apiKey || apiKey === 'your_key_here' || !imdbId) return null;
    try {
        const url = `http://www.omdbapi.com/?i=${imdbId}&apikey=${apiKey}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.Response === 'False') {
            console.log('[OMDb] Not found:', data.Error);
            return null;
        }
        return {
            poster: data.Poster && data.Poster !== 'N/A' ? data.Poster : null,
            imdbRating: data.imdbRating && data.imdbRating !== 'N/A' ? parseFloat(data.imdbRating) : null,
            title: data.Title !== 'N/A' ? data.Title : null,
            year: data.Year && data.Year !== 'N/A' ? parseInt(data.Year) : null,
            plot: data.Plot !== 'N/A' ? data.Plot : null,
            rated: data.Rated !== 'N/A' ? data.Rated : null,
            released: data.Released !== 'N/A' ? data.Released : null,
            runtime: data.Runtime !== 'N/A' ? data.Runtime : null,
            genre: data.Genre !== 'N/A' ? data.Genre : null,
            director: data.Director !== 'N/A' ? data.Director : null,
            writer: data.Writer !== 'N/A' ? data.Writer : null,
            actors: data.Actors !== 'N/A' ? data.Actors : null,
            country: data.Country !== 'N/A' ? data.Country : null
        };
    } catch (e) {
        console.error('[OMDb] Error:', e.message);
        return null;
    }
}

async function enrichContent(item) {
    if (!item.imdb_id) return item;
    const needsPoster = !item.poster_url;
    const needsRating = item.imdb_rating == null;
    const needsRated = item.rated == null;
    const needsReleased = item.released == null;
    const needsRuntime = item.runtime == null;
    const needsGenre = item.genre == null;
    const needsDirector = item.director == null;
    const needsWriter = item.writer == null;
    const needsActors = item.actors == null;
    const needsCountry = item.country == null;
    
    if (!needsPoster && !needsRating && !needsRated && !needsReleased && !needsRuntime && !needsGenre && !needsDirector && !needsWriter && !needsActors && !needsCountry) return item;
    const omdb = await fetchOmdbData(item.imdb_id);
    if (!omdb) return item;
    const updates = {};
    if (needsPoster && omdb.poster) updates.poster_url = omdb.poster;
    if (needsRating && omdb.imdbRating) updates.imdb_rating = omdb.imdbRating;

        if (needsRated && omdb.rated) updates.rated = omdb.rated;
        if (needsReleased && omdb.released) updates.released = omdb.released;
        if (needsRuntime && omdb.runtime) updates.runtime = omdb.runtime;
        if (needsGenre && omdb.genre) updates.genre = omdb.genre;
        if (needsDirector && omdb.director) updates.director = omdb.director;
        if (needsWriter && omdb.writer) updates.writer = omdb.writer;
        if (needsActors && omdb.actors) updates.actors = omdb.actors;
        if (needsCountry && omdb.country) updates.country = omdb.country;

    if (Object.keys(updates).length > 0) {
        const fields = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`).join(', ');
        const values = Object.values(updates);
        await pool.query(`UPDATE content SET ${fields} WHERE id = $1`, [item.id, ...values]);
        Object.assign(item, updates);
    }
    return item;
}

// === Парсинг плейлиста из строк ===
function parsePlaylist(rawLines) {
    if (!rawLines) return null;
    
    // Разбиваем на строки, очищаем пробелы, убираем совсем пустые
    const lines = rawLines.split('\n').map(l => l.trim()).filter(l => l);
    if (!lines.length) return null;

    const playlist = [];
    
    for (let i = 0; i < lines.length; i++) {
        const currentLine = lines[i];

        // Сценарий 1: Твой новый формат (Тайтл на одной строке, а следующая строка начинается с "|" или содержит URL)
        if (!currentLine.includes('|') && !currentLine.startsWith('http')) {
            const nextLine = lines[i + 1];
            if (nextLine) {
                // Если следующая строка содержит URL (с палочкой или без)
                const urlPart = nextLine.includes('|') ? nextLine.split('|')[1].trim() : nextLine.trim();
                if (urlPart.startsWith('http')) {
                    playlist.push({
                        title: currentLine, // Текст серии (например: Сезон 1 - Серия 1-2)
                        file: urlPart       // Чистый m3u8 урл
                    });
                    i++; // Пропускаем следующую строку, так как мы её уже забрали
                    continue;
                }
            }
        }

        // Сценарий 2: Старый формат в одну строку "Серия 1 | https://..."
        const parts = currentLine.split('|').map(p => p.trim());
        if (parts.length >= 2) {
            // Если первая часть пустая из-за ведущего |, берем дефолтный тайтл
            const title = parts[0] || 'Серия ' + (playlist.length + 1);
            playlist.push({
                title: title,
                file: parts[parts.length - 1]
            });
        } 
        // Сценарий 3: Просто голый URL в строке
        else if (currentLine.startsWith('http')) {
            playlist.push({
                title: 'Серия ' + (playlist.length + 1),
                file: currentLine
            });
        }
    }
    
    return playlist.length ? JSON.stringify(playlist) : null;
}

function isPlaylist(raw) {
    if (!raw) return false;
    return raw.trim().startsWith('[');
}

function getPlaylistPreview(raw) {
    if (!raw || !isPlaylist(raw)) return '';
    try {
        const list = JSON.parse(raw);
        return list.map((item, i) => `${item.title || ('Серия ' + (i+1))} | ${item.file}`).join('\n');
    } catch (e) {
        return raw;
    }
}

// === ROUTES ===
app.get('/', async (req, res) => {
    try {
        // 1. Пагинация: определяем текущую страницу
        const limit = 12; // Количество элементов на страницу
        const page = parseInt(req.query.page) || 1; // Если ?page= нет, то первая
        const offset = (page - 1) * limit;

        // 2. Получаем общее количество записей для расчета страниц
        const countResult = await pool.query('SELECT COUNT(*) FROM content WHERE is_active = true');
        const totalItems = parseInt(countResult.rows[0].count);
        const totalPages = Math.ceil(totalItems / limit);

        // 3. Получаем категории для хедера
        const categoriesResult = await pool.query(`
            SELECT name, slug FROM categories ORDER BY id ASC
        `);
        const grouped = {};
        categoriesResult.rows.forEach(cat => {
            grouped[cat.slug] = { name: cat.name, slug: cat.slug };
        });

        // 4. Основной контент: 10 добавленных с учетом OFFSET (пагинации)
        const itemsResult = await pool.query(`
            SELECT c.*, cat.name as category_name, cat.slug as category_slug
            FROM content c
            JOIN categories cat ON c.category_id = cat.id
            ORDER BY c.id DESC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);

        const latestItems = [];
        for (const row of itemsResult.rows) {
            latestItems.push(await enrichContent(row));
        }

        // 5. Сайдбар: Сериалы, сортированные по UPDATED_AT
        const sidebarResult = await pool.query(`
            SELECT c.title, c.slug, c.updated_at, c.updated_to
            FROM content c
            JOIN categories cat ON c.category_id = cat.id
            WHERE cat.slug = 'serialy' 
            ORDER BY c.updated_at DESC
            LIMIT 15
        `);

        // Передаем все данные в шаблон, включая переменные пагинации
        res.render('index', { 
            grouped, 
            items: latestItems,
            sidebarSerials: sidebarResult.rows,
            currentPage: page,
            totalPages: totalPages
        });

    } catch (e) {
        console.error('[ERROR] Index:', e.message);
        res.status(500).send('Server error');
    }
});

app.get('/watch/:slug', async (req, res) => {
    try {
        // 1. Получаем сам контент
        const r = await pool.query(`
            SELECT c.*, cat.name as category_name 
            FROM content c 
            JOIN categories cat ON c.category_id = cat.id 
            WHERE c.slug = $1
        `, [req.params.slug]);
        
        if (!r.rows.length) return res.status(404).send('Not found');
        
        const item = await enrichContent(r.rows[0]);
        item.is_playlist = isPlaylist(item.player_url);
        if (item.is_playlist) {
            try { item.playlist = JSON.parse(item.player_url); } catch (e) { item.playlist = []; }
        }

        // 2. Получаем список категорий для динамического меню в хедере
        const categoriesResult = await pool.query(`
            SELECT name, slug FROM categories ORDER BY id ASC
        `);

        // Превращаем в объект, похожий на ваш grouped (чтобы разметка в partials/header не ломалась)
        const grouped = {};
        categoriesResult.rows.forEach(cat => {
            grouped[cat.slug] = {
                name: cat.name,
                slug: cat.slug
            };
        });

        // 3. Передаем и фильм, и категории для хедера
        res.render('watch', { item, grouped });

    } catch (e) {
        console.error('[ERROR] Watch:', e.message);
        res.status(500).send('Server error');
    }
});

app.get('/api/content', async (req, res) => {
    try {
        const r = await pool.query('SELECT * FROM content WHERE is_active = true');
        res.json(r.rows);
    } catch (e) {
        res.status(500).json({ error: 'DB error' });
    }
});

// === ADMIN ===
app.get('/admin/login', (req, res) => {
    if (req.session.admin) return res.redirect('/admin');
    res.render('admin/login', { error: null });
});

app.post('/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
        req.session.admin = true;
        return res.redirect('/admin');
    }
    res.render('admin/login', { error: 'Неверный логин или пароль' });
});

app.get('/admin', requireAuth, async (req, res) => {
    try {
        const content = await pool.query(`
            SELECT c.*, cat.name as category_name 
            FROM content c 
            JOIN categories cat ON c.category_id = cat.id 
            ORDER BY c.id DESC
        `);
        const categories = await pool.query('SELECT * FROM categories ORDER BY sort_order');
        res.render('admin/dashboard', { content: content.rows, categories: categories.rows });
    } catch (e) {
        res.status(500).send('DB error');
    }
});

app.get('/admin/add', requireAuth, async (req, res) => {
    try {
        const categories = await pool.query('SELECT * FROM categories ORDER BY sort_order');
        res.render('admin/add', { categories: categories.rows, error: null });
    } catch (e) {
        res.redirect('/admin');
    }
});

app.post('/admin/add', requireAuth, async (req, res) => {
    try {
        const b = req.body;
        let posterUrl = b.poster_url || null;
        let imdbRating = b.imdb_rating ? parseFloat(b.imdb_rating) : null;
        let year = b.year ? parseInt(b.year) : null;
        let description = b.description || null;
        let title = b.title?.trim();
        if (!title) {
            const categories = await pool.query('SELECT * FROM categories ORDER BY sort_order');
            return res.render('admin/add', { categories: categories.rows, error: 'Название обязательно' });
        }
        if (b.imdb_id && (!posterUrl || !imdbRating || !year || !description || !b.rated || !b.genre || !b.director || !b.actors)) {
            const omdb = await fetchOmdbData(b.imdb_id);
            if (omdb) {
                if (!posterUrl && omdb.poster) posterUrl = omdb.poster;
                if (!imdbRating && omdb.imdbRating) imdbRating = omdb.imdbRating;
                if (!year && omdb.year) year = omdb.year;
                if (!description && omdb.plot) description = omdb.plot;
                if (!b.rated && omdb.rated) b.rated = omdb.rated;
                if (!b.released && omdb.released) b.released = omdb.released;
                if (!b.runtime && omdb.runtime) b.runtime = omdb.runtime;
                if (!b.genre && omdb.genre) b.genre = omdb.genre;
                if (!b.director && omdb.director) b.director = omdb.director;
                if (!b.writer && omdb.writer) b.writer = omdb.writer;
                if (!b.actors && omdb.actors) b.actors = omdb.actors;
                if (!b.country && omdb.country) b.country = omdb.country;
            }
        }

        let playerUrl = null;
        if (b.player_type === 'playlist') {
            playerUrl = parsePlaylist(b.playlist_lines);
        } else {
            playerUrl = b.player_url_single?.trim() || null;
        }

        const slug = b.slug?.trim() || slugify(title);
        await pool.query(`
            INSERT INTO content (title, original_title, year, description, poster_url, imdb_id, category_id, 
                rated, released, runtime, genre, director, writer, actors, country,
                imdb_rating, kinopoisk_rating, rotten_tomatoes_rating, player_url, external_url, slug, is_active)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
        `, [
            title, b.original_title || null, year, description, posterUrl, b.imdb_id || null,
            parseInt(b.category_id),
            b.rated || null, b.released || null, b.runtime || null, b.genre || null,
            b.director || null, b.writer || null, b.actors || null, b.country || null,
            imdbRating,
            b.kinopoisk_rating ? parseFloat(b.kinopoisk_rating) : null,
            b.rotten_tomatoes_rating ? parseInt(b.rotten_tomatoes_rating) : null,
            playerUrl, b.external_url || null, slug, b.is_active === 'on'
        ]);
        res.redirect('/admin');
    } catch (e) {
        console.error('[ERROR] Add:', e.message);
        const categories = await pool.query('SELECT * FROM categories ORDER BY sort_order');
        res.render('admin/add', { categories: categories.rows, error: 'Ошибка: ' + e.message });
    }
});

app.get('/admin/edit/:id', requireAuth, async (req, res) => {
    try {
        const item = await pool.query('SELECT * FROM content WHERE id = $1', [req.params.id]);
        const categories = await pool.query('SELECT * FROM categories ORDER BY sort_order');
        if (!item.rows.length) return res.redirect('/admin');
        const row = item.rows[0];
        row.is_playlist = isPlaylist(row.player_url);
        row.playlist_preview = getPlaylistPreview(row.player_url);
        res.render('admin/edit', { item: row, categories: categories.rows });
    } catch (e) {
        res.redirect('/admin');
    }
});

app.post('/admin/save/:id', requireAuth, async (req, res) => {
    try {
        const b = req.body;
        let posterUrl = b.poster_url || null;
        let imdbRating = b.imdb_rating ? parseFloat(b.imdb_rating) : null;
        if (b.imdb_id && (!posterUrl || !imdbRating)) {
            const omdb = await fetchOmdbData(b.imdb_id);
            if (omdb) {
                if (!posterUrl && omdb.poster) posterUrl = omdb.poster;
                if (!imdbRating && omdb.imdbRating) imdbRating = omdb.imdbRating;
            }
        }

        // 1. Собираем player_url и вытаскиваем имя последнего обновления
        let playerUrl = null;
        let updatedTo = null; // По умолчанию null (например, для фильмов)

        if (b.player_type === 'playlist') {
            playerUrl = parsePlaylist(b.playlist_lines);
            
            // Логика вытаскивания "Сезон 1 - Серия 8"
            if (b.playlist_lines && b.playlist_lines.trim()) {
                // Разбиваем текст на массив строк, убираем пустые
                const lines = b.playlist_lines.split('\n').map(l => l.trim()).filter(Boolean);
                if (lines.length > 0) {
                    // Берем самую последнюю строку из списка
                    const lastLine = lines[lines.length - 1];
                    
                    // Если в строке есть разделитель |, забираем левую часть
                    if (lastLine.includes('|')) {
                        updatedTo = lastLine.split('|')[0].trim();
                    } else {
                        // Если разделителя нет и вставили только ссылку, 
                        // запишем дефолтное значение или оставим null
                        updatedTo = `Серия ${lines.length}`;
                    }
                }
            }
        } else {
            playerUrl = b.player_url_single?.trim() || null;
            // Если это фильм (single), можно написать что-то дефолтное или оставить пустым
            updatedTo = 'Фильм'; 
        }

        // 2. Выполняем SQL-запрос (добавили updated_at и updated_to)
        await pool.query(`
            UPDATE content SET 
                title=$1, original_title=$2, year=$3, description=$4, poster_url=$5, imdb_id=$6,
                rated=$7, released=$8, runtime=$9, genre=$10, director=$11, writer=$12, actors=$13, country=$14,
                category_id=$15, imdb_rating=$16, kinopoisk_rating=$17, rotten_tomatoes_rating=$18,
                player_url=$19, external_url=$20, is_active=$21,
                updated_at=CURRENT_TIMESTAMP, updated_to=$23
            WHERE id=$22
        `, [
            b.title, b.original_title || null, b.year ? parseInt(b.year) : null,
            b.description || null, posterUrl, b.imdb_id || null,
            b.rated || null, b.released || null, b.runtime || null, b.genre || null,
            b.director || null, b.writer || null, b.actors || null, b.country || null,
            parseInt(b.category_id), imdbRating,
            b.kinopoisk_rating ? parseFloat(b.kinopoisk_rating) : null,
            b.rotten_tomatoes_rating ? parseInt(b.rotten_tomatoes_rating) : null,
            playerUrl, b.external_url || null,
            b.is_active === 'on', parseInt(req.params.id),
            updatedTo // Передаем как 23-й параметр
        ]);

        // Исправляем редирект (чтобы перенаправляло на ID фильма, а не на строку ':id')
        res.redirect(`/admin/edit/${req.params.id}`);
    } catch (e) {
        console.error('[ERROR] Save:', e.message);
        res.status(500).send('Save error');
    }
});

app.get('/admin/delete/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM content WHERE id = $1', [req.params.id]);
        res.redirect('/admin');
    } catch (e) {
        res.redirect('/admin');
    }
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Pazl Voice on port ${PORT}`);
});
