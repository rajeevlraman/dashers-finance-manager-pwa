// /js/auth-flow.js
export function initAuthFlow() {
  
  const splashScreen = document.getElementById('splashScreen');
  const loginScreen = document.getElementById('loginScreen');
  const appContainer = document.querySelector('.app-container');
  
  // Hide app container initially
  if (appContainer) {
    appContainer.style.display = 'none';
  }
  
  // Show login screen after splash
  setTimeout(() => {
    if (splashScreen) {
      splashScreen.classList.add('fade-out');
    }
    
    setTimeout(() => {
      if (splashScreen) {
        splashScreen.style.display = 'none';
      }
      
      if (loginScreen) {
        loginScreen.classList.add('show');
      }
    }, 500); // Wait for fade-out animation
  }, 3000); // Show splash for 3 seconds
}

// Handle login
export function handleLogin() {
  const loginScreen = document.getElementById('loginScreen');
  const appContainer = document.querySelector('.app-container');
  const loginForm = document.getElementById('loginForm');
  
  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      
      // Get credentials
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      
      // Simple validation (replace with real auth)
      if (email && password) {
        // Hide login screen
        if (loginScreen) {
          loginScreen.classList.remove('show');
          setTimeout(() => {
            loginScreen.style.display = 'none';
          }, 500);
        }
        
        // Show app container
        if (appContainer) {
          setTimeout(() => {
            appContainer.style.display = 'grid';
          }, 300);
        }
        
        // Store login state
        localStorage.setItem('loggedIn', 'true');
        localStorage.setItem('userEmail', email);
        
      }
    });
  }
}

// Check if already logged in
export function checkAuthState() {
  const isLoggedIn = localStorage.getItem('loggedIn') === 'true';
  
  if (isLoggedIn) {
    // Skip to app
    document.getElementById('splashScreen').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'none';
    document.querySelector('.app-container').style.display = 'grid';
  } else {
    // Show auth flow
    initAuthFlow();
    handleLogin();
  }
}