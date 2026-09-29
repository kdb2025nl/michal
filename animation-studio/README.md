# Animation Studio

Lokalna aplikacja do wielokrotnego tworzenia krótkich, animowanych filmów marketingowych z jednego opisu.
Wpisujesz opis w przeglądarce → aplikacja buduje storyboard i scenariusz lektora → (po Twojej akceptacji kosztu) generuje assety w Fal →
animuje je **proceduralnie** (Canvas 2D + WebGL2) → renderuje klatka po klatce (Puppeteer) → składa MP4/WebM (FFmpeg) → sprawdza jakość (QA).
Po instalacji **nie potrzebujesz Claude Code** do kolejnych filmów.

## Instalacja (Windows PowerShell, jednorazowo)

```powershell
# 0. Wymagania (pomiń, co już masz; po instalacji otwórz PowerShell ponownie)
winget install OpenJS.NodeJS.LTS          # Node.js 22+
winget install Python.Python.3.12         # Python 3.10+
winget install Google.Chrome              # albo użyj Microsoft Edge (jest w Windows)

# 1. Zależności
cd animation-studio
npm install                               # pobiera też FFmpeg/ffprobe (ffmpeg-static)
npm run setup                             # pip install -r requirements.txt (librosa, numpy, pillow, soundfile) + diagnostyka

# 2. Klucz Fal (tylko lokalnie, po stronie serwera)
Copy-Item .env.example .env
notepad .env                              # wpisz FAL_KEY=...   (plik .env jest w .gitignore)

# 3. Diagnostyka (opcjonalnie)
npm run doctor
```

## macOS (MacBook, Intel i Apple Silicon)

```bash
brew install node python@3.12            # + przeglądarka: brew install --cask google-chrome  (Chrome/Chromium/Edge/Brave wykrywane automatycznie)
cd animation-studio
npm install                              # ffmpeg-static / ffprobe-static mają binaria dla darwin arm64 i x64
npm run setup                            # tworzy .venv (Homebrew Python blokuje globalny pip) i instaluje librosa/numpy/pillow
cp .env.example .env && open -e .env     # wpisz FAL_KEY
npm run doctor                           # sprawdza też, czy FFmpeg ma enkodery libx264, libvpx-vp9, libopus, aac
npm run app                              # otwiera http://127.0.0.1:4377 w przeglądarce
```
UI działa w Chrome, Safari, Edge i Firefox (renderer używa własnej instancji Chrome/Chromium w tle, niezależnie od tego, czego używasz do oglądania). Uwaga: Safari/Chrome potrafią zbuforować `final.mp4` – przy podglądzie po ponownym renderze odśwież stronę.

## Online / hostowanie (Docker)

Aplikacja renderuje wideo na serwerze (Chrome + FFmpeg), więc „online” = uruchomienie tego samego serwera na maszynie w chmurze i wejście do niego z dowolnej przeglądarki.

```bash
docker build -t animation-studio .
docker run -p 4377:4377 -e APP_PASSWORD='dlugie-haslo' -e FAL_KEY='...' -v studio-data:/data animation-studio
```
* Serwer **odmawia startu** na adresie innym niż loopback bez `APP_PASSWORD` (za serwerem stoi płatny `FAL_KEY`). Hasło = HTTP Basic (dowolny login) na całym UI i API; ustaw HTTPS przed publicznym dostępem (reverse proxy: Caddy/Nginx, Fly.io, Railway, Cloudflare Tunnel).
* Wolumen `/data` trzyma projekty. Minimum 2 vCPU / 4 GB RAM: render 40 s w 720p trwa kilka minut na CPU.
* Ten wariant to jeden użytkownik / jedna kolejka. Wieloużytkownikowość (konta, kolejka Redis) nie jest zaimplementowana.

## Uruchomienie

```powershell
npm run app
```
Adres: **http://127.0.0.1:4377** (port zmienisz przez `PORT` w `.env`). Na Windows przeglądarka otworzy się sama (wyłączysz przez `$env:NO_OPEN=1`).

## Jak tego używać

1. **Opisz animację** (lub wybierz preset *Credit-IQ product explainer*), ustaw język, długość, format, styl, CTA, muzykę, głos. Opcjonalnie dodaj **zatwierdzone zrzuty ekranu**, logo, fonty i `product-facts.json`.
2. **Utwórz storyboard** (bezpłatnie). Zobaczysz sceny, scenariusz lektora, podgląd klatek (suwak) i **szacowany koszt**. Wszystko możesz edytować i zapisać.
3. **Generate (Final)** – po zaznaczeniu akceptacji kosztu uruchamia cały pipeline. **Draft** = niska rozdzielczość, *nigdy nie robi płatnych wywołań* (używa już wygenerowanych assetów albo lokalnych zastępników). **Mock** = lokalne, sztuczne assety testowe (bez Fal).
4. Obserwuj etapy: storyboard → obrazy → muzyka → lektor → kontrola Whisper → analiza audio → animacja → render → QA. Nieudany etap można **ponowić** – udane, płatne wywołania są zapisane w `assets/manifest.json` i nie są powtarzane.
5. Pobierz MP4, WebM, miniaturę PNG, scenariusz, napisy SRT, raport QA. Historia projektów jest na dole lewej kolumny.

## Modele Fal (zweryfikowane 2026-09-29 w oficjalnej dokumentacji fal.ai)

| Zadanie | Endpoint | Uwagi |
|---|---|---|
| Assety wizualne | `openai/gpt-image-2.5/sunburst/text-to-image` | GPT Image 2.5 **Sunburst**; `image_size` wielokrotności 16 → 1920×1088 / 1088×1920 / 1024×1024, kadrowane Pillow do docelowego formatu |
| Muzyka | `fal-ai/elevenlabs/music` | `prompt`, `music_length_ms` (3000–600000), `force_instrumental: true`; **$0.60 za rozpoczętą minutę** |
| Lektor | `fal-ai/elevenlabs/tts/eleven-v3` | `text`, `voice`, `language_code`; **$0.10 / 1000 znaków**; brak słownika wymowy w API → wymowa = podmiana tekstu (pole „Wymowa”) |
| Kontrola treści | `fal-ai/whisper` | `audio_url`, `chunk_level: word`; cena podana jako „$0 za sekundę obliczeń” → w UI oznaczona jako *nieznana* |

Schematy wejścia/wyjścia (dla muzyki i TTS z OpenAPI `fal.ai/api/openapi/queue/openapi.json?endpoint_id=…`) są odzwierciedlone w `server/providers.js`.
Ceny: `presets/pricing.json` (kopia z oficjalnych stron, do ręcznej aktualizacji). Wywołania idą przez oficjalny klient `@fal-ai/client`, klucz z `FAL_KEY` wyłącznie na serwerze.

## Bezpieczeństwo, koszty, prywatność

* `FAL_KEY` nigdy nie trafia do klienta, HTML, logów, raportów ani filmu (API zwraca tylko `falKeyPresent: true/false`; wszystkie błędy przechodzą przez `redact()`).
* **Limit wydatków** na projekt (`MAX_SPEND_USD`, domyślnie $2, do zmiany w UI) – wywołanie jest odrzucane *przed* wysłaniem, jeśli przekroczyłoby limit. **Limit ponowień** (`MAX_RETRIES`), **limit prób naprawy renderu** (`MAX_RENDER_ATTEMPTS`). Błędy 4xx nie są ponawiane.
* Pliki użytkownika (zrzuty, logo, fonty, fakty) zostają lokalnie. Pipeline **nie wysyła żadnego z nich do Fal**; UI pokazuje listę plików i tę informację, a `assertNoUserFiles()` blokuje każde żądanie z lokalną ścieżką lub data-URI bez jawnej zgody (test w `tests/cost-and-retries.test.js`). Do Fal trafia tylko tekst (prompty, tekst lektora) i wygenerowany lektor (do Whisper).
* Zrzuty ekranu produktu są animowane **bez zmian**; modele obrazowe generują wyłącznie tło (prompt zawiera „no text, no user interface, no screens, no people”). Bez zrzutów preset Credit-IQ pokazuje wyłącznie planszę koncepcyjną i wymaga jawnego potwierdzenia.
* **Twierdzenia**: liczby, „szybciej o X%”, integracje, okres próbny, wyniki finansowe itp. są blokowane w storyboardzie, chyba że tekst pochodzi z `product-facts.json` (`approvedClaims`). Lint jest słownikowy – to pomoc, nie gwarancja.

Format `product-facts.json`:
```json
{ "product": "Credit-IQ",
  "approvedClaims": [ { "id": "c1", "text": "Twoje zatwierdzone zdanie dokładnie tak, jak ma paść w filmie" } ],
  "cta": { "text": "Learn more about Credit-IQ", "url": "example.com/demo" } }
```

## Struktura

```
server/    API (Express), kolejka i etapy (pipeline.js), dostawcy Fal + mock (providers.js), koszty, schematy, render (Puppeteer+FFmpeg), QA
src/ui/    interfejs w przeglądarce
src/engine deterministyczny silnik animacji (engine.js) + player.html używany przez renderer
scripts/   analyze_music.py (librosa), prepare_layers.py (Pillow), qa_tools.py, mock_assets.py, doctor/setup/e2e/fal-smoke
presets/   credit-iq.json, pricing.json
tests/     testy jednostkowe (node:test)
projects/  wyniki – jeden katalog na generację (ignorowane przez git)
samples/   przykładowy wynik testu end-to-end (MP4, WebM, raport QA, zrzut UI)
```

Katalog projektu: `projects/<id>/` → `concept.json`, `product-facts.json` (jeśli dostarczono), `storyboard.json`, `timeline.json`, `voice-validation.json`, `qa-report.json`, `script.txt`, `assets/` (+`manifest.json`: prompt, model, id żądania, plik), `analysis/` (`music-analysis.json`, determinism, layout), `frames/`, `output/` (`final.mp4`, `final.webm`, `preview.png`, `contact-sheet.png`, `captions.srt`, stemy audio).

## Silnik animacji

`renderFrame(t)` jest czystą funkcją `(timeline, seed, t)` – bez `Date.now`/`Math.random`; etap „Animacja” sprawdza to (ta sama klatka dwa razy = identyczne piksele). Tekst, logo i CTA są renderowane jako ostre warstwy Canvas (nie w obrazach). WebGL2 służy tylko do winiety i subtelnego przesunięcia światła (jest wariant 2D, gdy WebGL2 niedostępny). Ruch: delikatny push-in kamery, wejścia elementów przyciągane do beatów, akcenty ≤0,6% zoomu na najmocniejszych beatach (max 2 na scenę). Marginesy bezpieczne per format (16:9, 9:16, 1:1), napisy ≥ 44 px przy 1080 px.

Render nie używa MediaRecorder: każda klatka to `renderFrame(i/fps)` → JPEG w `frames/` → FFmpeg (H.264/AAC MP4, VP9/Opus WebM). Miks: lektor + muzyka z ducking (sidechain) i limiterem.

## QA (`qa-report.json`)

ffprobe + pełne dekodowanie MP4/WebM (kodeki, FPS, rozdzielczość, czas), błędy JS i nieudane ładowania, brakujące assety, czarne/puste klatki, skoki na granicach scen, tekst poza bezpiecznym obszarem / za mały / kolizje, ucięty lektor, różnice Whisper, clipping, relacja lektor/muzyka (≥ 8 dB), CTA w ostatniej scenie. Raport zawiera **ograniczenia** automatycznej oceny. Przy błędach technicznych możliwych do naprawy (skala tekstu, ducking) pipeline poprawia parametry i renderuje ponownie – do `MAX_RENDER_ATTEMPTS`. Wynik `done_with_issues` oznacza, że film istnieje, ale QA nie przeszło.

## Testy

```powershell
npm test            # 26 testów: timeline, storyboard/claims, koszty, limity, ponowienia, Whisper, generowanie klatek + MP4
npm run test:e2e    # pełny przepływ z lokalnymi assetami (bez Fal): API + przeglądarka (dodaj -- --ui), zapisuje samples/
node scripts/fal-smoke.js   # MINIMALNY test prawdziwego Fal (wymaga FAL_KEY, twardy limit $0.05, ok. $0.01)
```

## Znane ograniczenia

* Storyboard budowany jest **regułowo** z Twojego opisu (kroki oddzielaj `->`, średnikiem lub nową linią) – bez LLM i bez automatycznego tłumaczenia. Tekst lektora bierze się z opisu; przejrzyj go i edytuj w UI.
* Obsługiwane są **zrzuty ekranu**; nagrania wideo UI nie są jeszcze wspierane.
* Whisper sprawdza treść (pominięcia/ucięcia/różnice), nie poprawność wymowy – posłuchaj lektora.
* Lista głosów w UI to głosy z dokumentacji Fal (nazwy ElevenLabs); wpisz własną nazwę, jeśli Fal doda kolejne.
* Ceny są kopią z dnia weryfikacji; obrazy szacowane proporcjonalnie do liczby pikseli.
