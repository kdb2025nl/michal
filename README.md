# Michał Witkowski - Landing Page Trenera Personalnego

Minimalistyczna strona internetowa typu landing page dla Michała Witkowskiego, certyfikowanego trenera personalnego z Rzeszowa.

## 📋 O projekcie

Strona została stworzona z myślą o profesjonalnej prezentacji usług trenera personalnego specjalizującego się w:
- **Programowaniu Treningowym** - indywidualne plany treningowe oparte na najnowszych badaniach
- **Konsultacjach Treningowych** - profesjonalne doradztwo online i stacjonarne
- **Kickboxing & Boxing** - treningi sportów walki dla wszystkich poziomów

## 🚀 Uruchomienie lokalne

### Opcja 1: Bezpośrednie otwarcie w przeglądarce

1. Przejdź do folderu projektu `michal-witkowski-landing`
2. Kliknij dwukrotnie na plik `index.html`
3. Strona otworzy się w Twojej domyślnej przeglądarce

### Opcja 2: Użycie lokalnego serwera (zalecane)

#### Używając Python:
```bash
# Python 3.x
python3 -m http.server 8000

# Python 2.x
python -m SimpleHTTPServer 8000
```

Następnie otwórz przeglądarkę i przejdź do: `http://localhost:8000`

#### Używając PHP:
```bash
php -S localhost:8000
```

#### Używając Node.js (npx):
```bash
npx serve
```

#### Używając VS Code:
Zainstaluj rozszerzenie "Live Server" i kliknij "Go Live" w prawym dolnym rogu.

## 📁 Struktura projektu

```
michal-witkowski-landing/
│
├── index.html          # Główny plik HTML
├── style.css           # Stylowanie strony
├── script.js           # Interaktywność i animacje
├── README.md           # Dokumentacja projektu
│
└── images/             # Folder na obrazy
    └── (tutaj dodaj zdjęcia transformacji klientów)
```

## 🎨 Funkcjonalności

### Sekcje strony:
1. **Hero Section** - Nagłówek z głównym CTA
2. **O mnie** - Informacje o trenerze i certyfikatach
3. **Oferta treningowa** - Szczegółowy opis usług
4. **Cennik** - Pakiety i ceny (do uzupełnienia)
5. **Galeria transformacji** - Efekty pracy z klientami
6. **Kontakt** - Formularz kontaktowy i dane

### Cechy techniczne:
- ✅ W pełni responsywna (mobile-first)
- ✅ Płynne przewijanie między sekcjami
- ✅ Animacje przy scrollowaniu
- ✅ Minimalistyczny, czysty design
- ✅ Menu mobilne (hamburger)
- ✅ Przycisk przewijania do góry
- ✅ Interaktywny formularz kontaktowy
- ✅ Efekty parallax
- ✅ Aktywne podświetlanie sekcji w nawigacji

## 📝 Personalizacja

### Dane kontaktowe
Edytuj plik `index.html` w sekcji `contact`:
- Email: `kontakt@michalwitkowski.pl`
- Telefon: `+48 123 456 789`
- Social media: Dodaj linki do Instagram i Facebook

### Cennik
W sekcji `pricing` uzupełnij ceny oznaczone jako `XXX zł`.

### Zdjęcia transformacji
1. Przejdź do folderu `images/`
2. Dodaj zdjęcia swoich klientów:
   - `placeholder-before.jpg` / `placeholder-after.jpg`
   - `placeholder-before-2.jpg` / `placeholder-after-2.jpg`
   - `placeholder-before-3.jpg` / `placeholder-after-3.jpg`
3. Zaktualizuj opisy w sekcji galerii

### Kolory
Jeśli chcesz zmienić schemat kolorów, edytuj zmienne CSS w pliku `style.css`:
```css
:root {
    --primary-color: #1a1a1a;      /* Główny kolor tekstu */
    --accent-color: #2c5f2d;       /* Kolor akcentujący (zielony) */
    --light-accent: #97be5a;       /* Jasny akcent */
}
```

## 🔧 Integracja formularza kontaktowego

Aktualnie formularz wyświetla alert po wysłaniu. Aby połączyć go z prawdziwym backendem:

### Opcja 1: Email.js (darmowe)
```javascript
// W pliku script.js zamień funkcję submit na:
emailjs.send("YOUR_SERVICE_ID", "YOUR_TEMPLATE_ID", formData)
    .then(() => alert('Wiadomość wysłana!'));
```

### Opcja 2: Formspree
```html
<!-- W index.html zmień tag <form>: -->
<form action="https://formspree.io/f/TWOJ_ID" method="POST">
```

### Opcja 3: Własny backend
Odkomentuj kod fetch w `script.js` i skonfiguruj endpoint API.

## 📱 SEO i Meta Tagi

Strona zawiera podstawowe meta tagi dla SEO:
- Title: "Michał Witkowski - Trener Personalny Rzeszów"
- Description: Pełny opis usług
- Keywords: Słowa kluczowe dla wyszukiwarek

Możesz je edytować w sekcji `<head>` pliku `index.html`.

## 🌐 Wdrożenie (deployment)

### Darmowe opcje hostingu:

1. **GitHub Pages**
   - Stwórz repozytorium na GitHub
   - Wrzuć pliki projektu
   - Włącz GitHub Pages w ustawieniach repo

2. **Netlify**
   - Przeciągnij folder projektu na netlify.com
   - Otrzymasz darmowy hosting i HTTPS

3. **Vercel**
   - Zaimportuj projekt z GitHub
   - Automatyczne wdrożenie

## 📊 Testowanie

Przetestuj stronę przed wdrożeniem:
- ✅ Sprawdź działanie na różnych urządzeniach (mobile, tablet, desktop)
- ✅ Przetestuj wszystkie linki i przyciski
- ✅ Wypełnij i wyślij formularz kontaktowy
- ✅ Sprawdź czas ładowania strony
- ✅ Zweryfikuj poprawność danych kontaktowych

## 🛠️ Technologie

- HTML5
- CSS3 (Custom Properties, Grid, Flexbox)
- Vanilla JavaScript (ES6+)
- Intersection Observer API (animacje scroll)
- SVG Icons

## 📄 Licencja

Projekt stworzony dla Michała Witkowskiego. Wszelkie prawa zastrzeżone.

## 💡 Wsparcie

W razie pytań dotyczących modyfikacji lub problemów technicznych:
1. Sprawdź konsolę przeglądarki (F12) w poszukiwaniu błędów
2. Upewnij się, że wszystkie pliki są w odpowiednich folderach
3. Sprawdź, czy ścieżki do plików CSS i JS są poprawne

---

**Michał Witkowski** - Certyfikowany Coach Hypertrophy Academy
Rzeszów | Programowanie Treningowe | Kickboxing & Boxing Coach
