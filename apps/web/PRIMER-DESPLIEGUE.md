# Qué verifica el dueño en el primer despliegue (último paso de W0)

El despliegue está deshabilitado (`git.deploymentEnabled: false` en `vercel.json`). Antes de habilitarlo,
se crea el proyecto/preview y se comprueba, con `curl` contra la URL del preview (sin secretos en ningún lado):

1. **Forma del repositorio:** que Vercel instale y compile el workspace. Hoy `vercel.json` está en la raíz y la
   _Root Directory_ del proyecto es la raíz (`.`); si se usa `apps/web` como _Root Directory_, `vercel.json` se lee
   de `apps/web` (hay que moverlo) y hay que confirmar que la instalación corre desde la raíz. Si no funciona: plan B
   del spec (sin workspaces).
2. **Node 24** en el proyecto (Settings, Node.js Version) y región de funciones `gru1`.
3. **Cabecera de host:** que `host` traiga el dominio que se pidió. Prueba: `curl -sI -H 'Host: otro.com' <preview>`
   sigue dando 404 neutro con `x-robots-tag: noindex`, y sin `set-cookie` ni `x-powered-by`.
4. **No se falsifica:** `curl -sI -H 'x-zh-marca: x' -H 'X-Forwarded-Host: otra.com' <preview>/` da la misma respuesta que sin ellos.
5. **HSTS:** `curl -sI https://<dominio>/` trae `strict-transport-security` (lo pone Vercel; si no, lo agrega W4).
6. Que `/favicon.ico`, `/robots.txt` y `/api/auth/x` devuelvan la misma neutra (404), nunca un archivo.
