# 🚀 Flashcards Backend API

Un microservicio robusto y ligero construido con **Node.js** y **Express** para gestionar el contenido de la aplicación de Flashcards. Diseñado para ser desplegado fácilmente con contenedores Docker y conectar con una base de datos MySQL.

## 🛠️ Tecnologías

- **Runtime:** Node.js
- **Framework:** Express.js 5.x
- **Base de Datos:** MySQL (conector `mysql2`)
- **Contenerización:** Docker
- **CI/CD:** GitHub Actions (Despliegue automático en EasyPanel)

## 🔌 API Endpoints

### Health Check
Comprueba el estado del servicio y la conexión a la base de datos.
- **GET** `/health`

### Tarjetas (Cards)

Gestiona las tarjetas de aprendizaje (Preguntas y Respuestas).

#### Obtener todas las tarjetas
- **GET** `/cards`
- **Respuesta:** Array de objetos JSON con `id`, `pregunta`, `respuesta`.

#### Crear una nueva tarjeta
- **POST** `/cards`
- **Body:**
  ```json
  {
    "pregunta": "How do you say 'Hello'?",
    "respuesta": "Hola"
  }
  ```

#### Actualizar una tarjeta existente
- **PUT** `/cards/:id`
- **Body:**
  ```json
  {
    "pregunta": "Texto actualizado",
    "respuesta": "Respuesta actualizada"
  }
  ```

## ⚙️ Configuración (Variables de Entorno)

Para ejecutar este proyecto, necesitas configurar las siguientes variables de entorno (crea un archivo `.env` para local o configúralas en tu contenedor):

| Variable | Descripción |
|----------|-------------|
| `DB_HOST` | Host de la base de datos MySQL |
| `DB_USER` | Usuario de la base de datos |
| `DB_PASSWORD` | Contraseña del usuario |
| `DB_NAME` | Nombre de la base de datos |
| `PORT` | Puerto del servidor (Por defecto: 3000) - *Interno* |

## 🚀 Instalación y Ejecución

### Ejecución Local

1.  **Instalar dependencias:**
    ```bash
    npm install
    ```

2.  **Iniciar el servidor:**
    ```bash
    node src/index.js
    ```

### Ejecución con Docker

1.  **Construir la imagen:**
    ```bash
    docker build -t backend-flashcards .
    ```

2.  **Correr el contenedor:**
    ```bash
    docker run -p 3000:3000 --env-file .env backend-flashcards
    ```

## 📦 Despliegue

El proyecto cuenta con un workflow de GitHub Actions configurado en `.github/workflows/deploy.yml` que activa un webhook de despliegue en **EasyPanel** cada vez que se hace un push a la rama `main`.
