CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    slug VARCHAR(50) NOT NULL UNIQUE,
    sort_order INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS content (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    original_title VARCHAR(255),
    year INT,
    description TEXT,
    poster_url VARCHAR(500),
    category_id INT REFERENCES categories(id),
    imdb_rating DECIMAL(3,1),
    kinopoisk_rating DECIMAL(3,1),
    rotten_tomatoes_rating INT,
    player_url TEXT,
    external_url VARCHAR(500),
    slug VARCHAR(255) UNIQUE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO categories (name, slug, sort_order) VALUES 
('Фильмы', 'filmy', 1),
('Сериалы', 'serialy', 2),
('Мультфильмы', 'mult', 3),
('Аниме', 'anime', 4);

INSERT INTO content (title, original_title, year, description, poster_url, category_id, imdb_rating, kinopoisk_rating, rotten_tomatoes_rating, player_url, external_url, slug) VALUES 
('Гарри Поттер 20 лет спустя: Возвращение в Хогвартс', 'Harry Potter 20th Anniversary: Return to Hogwarts', 2022, 'Документальный специальный выпуск к 20-летию франшизы. Актеры воссоединяются в Хогвартсе и делятся воспоминаниями.', 'https://via.placeholder.com/300x450/111/fff?text=Harry+Potter', 1, 8.0, 7.9, 94, 'https://example.com/video1.mp4', 'https://wc.lordfilm135.ru/filmy/43835-garri-potter-20-let-spustja-vozvraschenie-v-hogvarts-2022-3792-97450.html', 'garri-potter-20-let-spustja'),
('Игра в кальмара', 'Squid Game', 2021, 'Сотни игроков, испытывающих финансовые трудности, принимают приглашение обезопасить свое будущее, соревнуясь в детских играх со смертельно высокими ставками.', 'https://via.placeholder.com/300x450/111/fff?text=Squid+Game', 2, 8.0, 7.6, 95, 'https://example.com/video2.mp4', 'https://wc.lordfilm135.ru/serialy/42236-igra-v-kalmara-2021-4360-88162.html', 'igra-v-kalmara'),
('Босс-молокосос 2', 'The Boss Baby: Family Business', 2021, 'Братья Темплтоны стали взрослыми и отдалились друг от друга, но новая миссия возвращает их в детство.', 'https://via.placeholder.com/300x450/111/fff?text=Boss+Baby', 3, 5.9, 6.5, 75, 'https://example.com/video3.mp4', 'https://wc.lordfilm135.ru/mult/41672-boss-molokosos-2-2021-0233-44008.html', 'boss-molokosos-2');