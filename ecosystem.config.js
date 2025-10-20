// ecosystem.config.js

module.exports = {
  apps: [
    {
      name: "tasas-scraper",
      // 💡 Comanda que ejecuta Node.js para iniciar Next.js en modo producción
      script: "node_modules/next/dist/bin/next",
      args: "start",
      // Configuración de PM2 para manejar la aplicación
      watch: false, // Desactiva el reinicio automático por cambios de archivos
      exec_mode: "fork", // Ejecuta como un proceso independiente
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};