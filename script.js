// ==========================================================================
// Mobile Menu Toggle
// ==========================================================================

const hamburger = document.querySelector('.hamburger');
const navMenu = document.querySelector('.nav-menu');
const navLinks = document.querySelectorAll('.nav-link');

function toggleMenu() {
    hamburger.classList.toggle('active');
    navMenu.classList.toggle('active');
}

if (hamburger) {
    hamburger.addEventListener('click', toggleMenu);
}

// Close mobile menu when clicking on a nav link
navLinks.forEach(link => {
    link.addEventListener('click', () => {
        if (navMenu.classList.contains('active')) {
            toggleMenu();
        }
    });
});

// ==========================================================================
// Smooth Scrolling
// ==========================================================================

document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));

        if (target) {
            const navbarHeight = document.querySelector('.navbar').offsetHeight;
            const targetPosition = target.offsetTop - navbarHeight;

            window.scrollTo({
                top: targetPosition,
                behavior: 'smooth'
            });
        }
    });
});

// ==========================================================================
// Scroll Animations
// ==========================================================================

const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver(function(entries) {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
        }
    });
}, observerOptions);

// Observe all elements with fade-in-scroll class
const fadeElements = document.querySelectorAll('.fade-in-scroll');
fadeElements.forEach(element => {
    observer.observe(element);
});

// ==========================================================================
// Scroll to Top Button
// ==========================================================================

const scrollTopBtn = document.getElementById('scrollTop');

function checkScrollPosition() {
    if (window.pageYOffset > 300) {
        scrollTopBtn.classList.add('visible');
    } else {
        scrollTopBtn.classList.remove('visible');
    }
}

window.addEventListener('scroll', checkScrollPosition);

if (scrollTopBtn) {
    scrollTopBtn.addEventListener('click', () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
}

// ==========================================================================
// Navbar Background on Scroll
// ==========================================================================

const navbar = document.querySelector('.navbar');

window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
        navbar.style.boxShadow = '0 2px 20px rgba(0, 0, 0, 0.1)';
    } else {
        navbar.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.05)';
    }
});

// ==========================================================================
// Contact Form Handling
// ==========================================================================

const contactForm = document.getElementById('contactForm');

if (contactForm) {
    contactForm.addEventListener('submit', function(e) {
        e.preventDefault();

        // Get form data
        const formData = {
            name: document.getElementById('name').value,
            email: document.getElementById('email').value,
            phone: document.getElementById('phone').value,
            service: document.getElementById('service').value,
            message: document.getElementById('message').value
        };

        // Here you would typically send the data to a server
        // For now, we'll just show an alert
        alert('Dziękuję za wiadomość, ' + formData.name + '! Skontaktuję się z Tobą wkrótce.');

        // Reset form
        contactForm.reset();

        // In a real application, you would send the data like this:
        /*
        fetch('/api/contact', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(formData)
        })
        .then(response => response.json())
        .then(data => {
            alert('Wiadomość wysłana pomyślnie!');
            contactForm.reset();
        })
        .catch(error => {
            alert('Wystąpił błąd. Spróbuj ponownie.');
            console.error('Error:', error);
        });
        */
    });
}

// ==========================================================================
// Active Navigation Link on Scroll
// ==========================================================================

const sections = document.querySelectorAll('section[id]');

function highlightNavigation() {
    const scrollY = window.pageYOffset;

    sections.forEach(section => {
        const sectionHeight = section.offsetHeight;
        const sectionTop = section.offsetTop - 100;
        const sectionId = section.getAttribute('id');
        const navLink = document.querySelector(`.nav-link[href="#${sectionId}"]`);

        if (navLink) {
            if (scrollY > sectionTop && scrollY <= sectionTop + sectionHeight) {
                navLink.style.color = 'var(--accent-color)';
            } else {
                navLink.style.color = '';
            }
        }
    });
}

window.addEventListener('scroll', highlightNavigation);

// ==========================================================================
// Parallax Effect on Hero Section (subtle)
// ==========================================================================

const hero = document.querySelector('.hero');

if (hero) {
    window.addEventListener('scroll', () => {
        const scrolled = window.pageYOffset;
        const parallaxSpeed = 0.5;

        if (scrolled < hero.offsetHeight) {
            hero.style.transform = `translateY(${scrolled * parallaxSpeed}px)`;
        }
    });
}

// ==========================================================================
// Form Input Focus Effects
// ==========================================================================

const formInputs = document.querySelectorAll('.form-group input, .form-group textarea, .form-group select');

formInputs.forEach(input => {
    input.addEventListener('focus', function() {
        this.parentElement.style.transform = 'scale(1.02)';
        this.parentElement.style.transition = 'transform 0.3s ease';
    });

    input.addEventListener('blur', function() {
        this.parentElement.style.transform = 'scale(1)';
    });
});

// ==========================================================================
// Loading Animation
// ==========================================================================

window.addEventListener('load', () => {
    document.body.style.opacity = '0';
    setTimeout(() => {
        document.body.style.transition = 'opacity 0.5s ease';
        document.body.style.opacity = '1';
    }, 100);
});

// ==========================================================================
// Pricing Card Hover Effect Enhancement
// ==========================================================================

const pricingCards = document.querySelectorAll('.pricing-card');

pricingCards.forEach(card => {
    card.addEventListener('mouseenter', function() {
        this.style.transition = 'all 0.3s ease';
    });
});

// ==========================================================================
// Image Lazy Loading Fallback (for older browsers)
// ==========================================================================

if ('loading' in HTMLImageElement.prototype) {
    const images = document.querySelectorAll('img[loading="lazy"]');
    images.forEach(img => {
        img.src = img.dataset.src || img.src;
    });
} else {
    // Fallback for older browsers
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/lazysizes/5.3.2/lazysizes.min.js';
    document.body.appendChild(script);
}

// ==========================================================================
// Console Welcome Message
// ==========================================================================

console.log('%c Michał Witkowski - Trener Personalny ',
    'background: #2c5f2d; color: white; padding: 10px 20px; font-size: 16px; font-weight: bold;');
console.log('%c Certyfikowany Coach Hypertrophy Academy | Rzeszów ',
    'color: #2c5f2d; font-size: 12px;');
