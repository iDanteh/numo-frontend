// ⚠️  IMPORTANTE: `auth0.audience` DEBE coincidir con AUTH0_AUDIENCE del backend (.env).
//    Si usas una API custom en Auth0, el audience es el "API Identifier" que registraste,
//    NO la URL del Management API (/api/v2/).
export const environment = {
  production: false,
  apiUrl:     'http://localhost:3000/api',
  appUrl:     'http://localhost:4200',
  auth0: {
    domain:   'dev-hrqcugo7q13wcwz0.us.auth0.com',
    clientId: 'H6rMJfuI1Vr6fNmPYRm1JXysuut7voZ5',
    audience: 'https://dev-hrqcugo7q13wcwz0.us.auth0.com/api/v2/',
  },
};
