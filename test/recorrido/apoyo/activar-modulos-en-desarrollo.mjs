// SOLO DE PRUEBAS. Lo carga el recorrido de la venta con NODE_OPTIONS=--import al lanzar `next start`; ningún archivo de `src/`, de `apps/` ni de `vercel.json` lo nombra (lo vigila
// `test/arquitectura/reglas.test.ts`, el bloque «el módulo de ARCA simulada del recorrido no puede llegar a producción»), así que un despliegue real nunca lo ejecuta.
// Qué hace: en ESTE proceso, el catálogo de módulos compilado (el que trae `"cuentas.agregar_linea"`) se lee con los módulos «en desarrollo» como «disponibles». En la app real siguen «en
// desarrollo» hasta que el dueño los pase a «disponible» (fila 172 de `decisiones-del-dueno-2026-11.md`, punto 1): hasta entonces ninguna pantalla de mostrador se puede ver, ni siquiera por
// quien tiene el permiso. Cada empresa del recorrido sigue necesitando el módulo activo por su plan (`modulo_de_empresa`): esto no activa nada por sí solo.
import Module from "node:module";

const compilar = Module.prototype._compile;
Module.prototype._compile = function (contenido, nombreDeArchivo) {
  const esElCatalogo =
    typeof contenido === "string" &&
    contenido.includes('"cuentas.agregar_linea"') &&
    contenido.includes('estado:"en_desarrollo"');
  return compilar.call(
    this,
    esElCatalogo
      ? contenido.replaceAll('estado:"en_desarrollo"', 'estado:"disponible"')
      : contenido,
    nombreDeArchivo,
  );
};
