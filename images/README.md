# Folder na obrazy

## Instrukcja dodawania zdjęć transformacji

W tym folderze należy umieścić zdjęcia transformacji Twoich klientów.

### Wymagane pliki:

1. **placeholder-before.jpg** - Zdjęcie "przed" dla pierwszej transformacji
2. **placeholder-after.jpg** - Zdjęcie "po" dla pierwszej transformacji
3. **placeholder-before-2.jpg** - Zdjęcie "przed" dla drugiej transformacji
4. **placeholder-after-2.jpg** - Zdjęcie "po" dla drugiej transformacji
5. **placeholder-before-3.jpg** - Zdjęcie "przed" dla trzeciej transformacji
6. **placeholder-after-3.jpg** - Zdjęcie "po" dla trzeciej transformacji

### Zalecenia dotyczące zdjęć:

- **Format**: JPG lub PNG
- **Proporcje**: 3:4 (pionowo) - np. 600x800px lub 900x1200px
- **Rozmiar pliku**: Maksymalnie 500KB na zdjęcie (optymalizuj przed wrzuceniem)
- **Jakość**: Wysoka, ale zoptymalizowana dla web
- **Tło**: Jednolite, neutralne tło w tym samym miejscu dla zdjęć "przed" i "po"
- **Oświetlenie**: Podobne warunki oświetleniowe dla wszystkich zdjęć

### Narzędzia do optymalizacji zdjęć:

- **Online**: TinyPNG (https://tinypng.com)
- **Photoshop**: Zapisz jako "Save for Web"
- **GIMP**: Export > Jakość 85%
- **ImageOptim** (Mac)
- **RIOT** (Windows)

### Dodatkowe obrazy (opcjonalnie):

Możesz również dodać:
- **logo.png** - Logo trenera (jeśli posiadasz)
- **profile.jpg** - Twoje zdjęcie profilowe do sekcji "O mnie"
- **gym-background.jpg** - Zdjęcie siłowni jako tło hero section

### Prywatność klientów:

⚠️ **WAŻNE**: Pamiętaj, aby przed publikacją zdjęć transformacji:
1. Uzyskać pisemną zgodę klienta na wykorzystanie zdjęć
2. Rozważyć zanonimizowanie twarzy (rozmycie/zakrycie)
3. Nie publikować danych osobowych bez zgody (imię, nazwisko możesz zastąpić "Klient #1")

### Aktualizacja ścieżek w kodzie:

Po dodaniu zdjęć, edytuj plik `index.html` w sekcji galerii, aby zaktualizować ścieżki i opisy:

```html
<img src="images/twoja-nazwa-pliku.jpg" alt="Przed treningiem">
```

---

**Powodzenia w budowaniu swojej galerii transformacji!**
