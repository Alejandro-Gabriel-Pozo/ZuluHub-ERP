/**
 * Matriz de invariantes del guardián (contratos-arquitectonicos.md §4, G1c paso B).
 *
 * NO es una lista de cada símbolo: es una matriz verificable
 *   invariante → elementos que lo definen, aplican, parametrizan y hacen obligatorio
 *             → mutaciones que prueban su protección.
 * Este archivo es el catálogo DECLARATIVO. Qué hace cada mutación (el aplicador) vive en las pruebas
 * (`test/arquitectura/guardian-matriz-apoyo.ts`) porque necesita repositorios sintéticos; la prueba
 * `test/arquitectura/guardian-matriz.test.ts` aplica cada una, corre el guardián (o el verificador de
 * `verificar-mecanismo.cjs`) y exige que FALLE como se declara acá. Una mutación que sobrevive es un
 * hueco: la prueba falla.
 *
 * Forma de una mutación:
 *  - `id`            único en toda la matriz (M5); es la clave de su aplicador;
 *  - `tipo`          eliminacion | alteracion | duplicacion | desconexion | exclusion | elusion;
 *  - `objetivo`      sobre qué se aplica: `repo` (repositorio sintético en memoria, corre el
 *                    guardián), `package-json`, `workflow`, `vitest-config`, `pruebas-del-guardian`
 *                    (textos reales alterados en memoria), `informe`, `canario` (corre el CLI sobre un
 *                    repo roto conocido) o `matriz` (una copia de este mismo catálogo);
 *  - `descripcion`   qué se le hace al sistema;
 *  - `esperado`      qué tiene que pasar: `{ codigo, archivo?, linea? | lineaDe?, contrato?,
 *                    contieneMotivo? }` (la verificación FALLA con ese código y, si se fija, en ese
 *                    archivo y línea exactos), o `{ pasa: true }` para lo que NO debe fallar;
 *  - `noAplica`      en vez de `esperado`: por qué ese tipo de mutación no tiene sentido para el
 *                    invariante (el motivo es obligatorio: M2);
 *  - `pendiente`     HUECO ABIERTO: la mutación hoy SOBREVIVE (el guardián no falla) y el motivo dice
 *                    qué falta. La prueba exige que siga sobreviviendo; si alguien cierra el hueco y no
 *                    saca la marca, falla (así un hueco nunca queda anotado de más ni olvidado).
 * `lineaDe` es `"texto"` o `{ texto, despuesDe }`: la línea del primer renglón que contiene `texto`
 * (después de `despuesDe`) en el archivo ALTERADO, para no atar el catálogo a números de línea de
 * archivos reales que otras personas editan.
 *
 * Meta-invariantes que también se prueban (`comprobarMatriz`):
 *  - M1  cada código de `CODIGOS_DE_FALLA` pertenece a ≥ 1 invariante (y tiene ≥ 1 mutación que lo espera);
 *  - M2  cada invariante tiene mutaciones de cada tipo o un `noAplica` con motivo;
 *  - M3  toda falla de toda mutación trae archivo y línea entera ≥ 1 (lo comprueba la prueba);
 *  - M4  ninguna prueba del guardián ni de la matriz está saltada ni excluida (`verificar-mecanismo`);
 *  - M5  cada id de mutación es único y cada mutación tiene su aplicador.
 */
const { CODIGOS_DE_MECANISMO } = require("./verificar-mecanismo.cjs");

const ARCHIVO_DE_LA_MATRIZ = "arquitectura/contratos/invariantes.cjs";
const TIPOS_DE_MUTACION = Object.freeze([
  "eliminacion",
  "alteracion",
  "duplicacion",
  "desconexion",
  "exclusion",
  "elusion",
]);
const OBJETIVOS = Object.freeze([
  "repo",
  "package-json",
  "workflow",
  "vitest-config",
  "pruebas-del-guardian",
  "informe",
  "canario",
  "matriz",
]);
const IDS_DE_INVARIANTES = Object.freeze([
  "I1",
  "I2",
  "I3",
  "I4",
  "I5",
  "I6",
  "I7",
  "I8",
  "I9",
  "I10",
]);
const CLAVES_DE_ELEMENTOS = Object.freeze(["aplica", "define", "parametriza", "hacePosible"]);
const LARGO_MINIMO_DEL_MOTIVO = 20;

const GUARDIAN = "arquitectura/contratos/guardian.cjs";
const CLASIFICACION = "arquitectura/contratos/clasificacion.cjs";
const DECLARACIONES = "arquitectura/contratos/declaraciones.cjs";
const COMPARACION = "arquitectura/contratos/comparacion.cjs";
const EXCEPCIONES = "arquitectura/contratos/excepciones.cjs";
const REGISTRO = "arquitectura/contratos/registro.cjs";
const MECANISMO = "arquitectura/contratos/verificar-mecanismo.cjs";
const CI = ".github/workflows/ci.yml";
const PRUEBAS = "test/arquitectura/guardian-*.test.ts";

/** @type {readonly object[]} */
const INVARIANTES = [
  {
    id: "I1",
    enunciado: "Toda ruta versionada tiene exactamente una clase.",
    elementos: {
      aplica: [`${CLASIFICACION}#clasificar`, `${GUARDIAN}#ejecutar (clase-sin-rutas)`],
      define: [`${CLASIFICACION}#NIVELES`, `${CLASIFICACION}#CLASES`],
      parametriza: [`${CLASIFICACION}#CLASES_ESPERADAS`, `${CLASIFICACION}#CLASES_EXCLUIBLES`],
      hacePosible: ["`git ls-files` (cargarDelRepo)", "npm run guardian", `${PRUEBAS}`],
    },
    codigosDeFalla: [
      "regla-de-clasificacion-invalida",
      "ruta-sin-clase",
      "clasificacion-ambigua",
      "clase-sin-rutas",
    ],
    mutaciones: [
      {
        id: "I1-quitar-la-regla-de-una-carpeta",
        tipo: "eliminacion",
        objetivo: "repo",
        descripcion: "Se elimina de la tabla la regla de `src/modulos/empresas/**`.",
        esperado: {
          codigo: "ruta-sin-clase",
          archivo: "src/modulos/empresas/dominio/empresa.ts",
          linea: 1,
        },
      },
      {
        id: "I1-vaciar-una-clase-esperada",
        tipo: "eliminacion",
        objetivo: "repo",
        descripcion: "Se borran todos los archivos de la clase `scripts`.",
        esperado: {
          codigo: "clase-sin-rutas",
          archivo: CLASIFICACION,
          linea: 6,
          contieneMotivo: "«scripts»",
        },
      },
      {
        id: "I1-mover-codigo-fuera-de-las-reglas",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "Una hoja de estilos se mueve a una carpeta que ninguna regla clasifica.",
        esperado: { codigo: "ruta-sin-clase", archivo: "herramientas/Linea.module.css", linea: 1 },
      },
      {
        id: "I1-renombrar-una-carpeta",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "El módulo `empresas` se renombra a `clientes` con todo su contenido.",
        esperado: {
          codigo: "ruta-sin-clase",
          archivo: "src/modulos/clientes/dominio/empresa.ts",
          linea: 1,
        },
      },
      {
        id: "I1-duplicar-la-regla-con-otra-clase",
        tipo: "duplicacion",
        objetivo: "repo",
        descripcion:
          "Se agrega, en el mismo nivel, una regla que clasifica `empresas` como frontend.",
        esperado: {
          codigo: "clasificacion-ambigua",
          archivo: "src/modulos/empresas/dominio/empresa.ts",
          linea: 1,
        },
      },
      {
        id: "I1-regla-desconectada-de-su-carpeta",
        tipo: "desconexion",
        objetivo: "repo",
        descripcion:
          "El glob de la regla de `empresas` queda apuntando a una carpeta que no existe.",
        esperado: {
          codigo: "ruta-sin-clase",
          archivo: "src/modulos/empresas/dominio/empresa.ts",
          linea: 1,
        },
      },
      {
        id: "I1-clase-que-se-ignora-sin-exclusion",
        tipo: "exclusion",
        objetivo: "repo",
        descripcion:
          "Se agrega la clase `ignorada` (con su regla) para que `tmp/` no se analice, sin exclusión registrada.",
        esperado: {
          codigo: "regla-de-clasificacion-invalida",
          archivo: CLASIFICACION,
          linea: 12,
          contieneMotivo: "ignorada",
        },
      },
      {
        id: "I1-reclasificar-codigo-como-documentacion",
        tipo: "elusion",
        objetivo: "repo",
        descripcion:
          "La tabla de clasificación manda `src/capacidades/**` a la clase `docs` (excluida) mientras ahí se usa un contrato sin declararlo.",
        esperado: {
          codigo: "clase-excluida-con-codigo",
          archivo: "arquitectura/contratos/clasificacion.cjs",
          linea: 9,
        },
        pendiente:
          "HUECO: nada impide que la tabla mande código a una clase excluida (docs o generado); el uso queda sin analizar y la unidad que declara `noUsa` sigue pasando. Con un solo árbol no se distingue una reclasificación legítima de una maliciosa: lo cubre el guardián de `main` (§5) con su propia tabla, y se cierra con un chequeo propio (las clases excluidas solo admiten extensiones de documentos o archivos de bloqueo). El código esperado es provisorio.",
      },
    ],
  },
  {
    id: "I2",
    enunciado: "Toda unidad declara sus contratos (o declara que no tiene).",
    elementos: {
      aplica: [`${DECLARACIONES}#leerDeclaraciones`, `${DECLARACIONES}#descubrirUnidades`],
      define: ["<unidad>/contratos.json de cada unidad", `${DECLARACIONES}#unidadDe`],
      parametriza: [`${DECLARACIONES}#GRUPOS_FIJOS`, `${DECLARACIONES}#CAMPOS_PERMITIDOS`],
      hacePosible: [`${GUARDIAN}#ejecutar`, "npm run guardian", `${PRUEBAS}`],
    },
    codigosDeFalla: [
      "unidad-sin-declaracion",
      "declaracion-invalida",
      "declara-contrato-inexistente",
      "ruta-sin-clase",
    ],
    mutaciones: [
      {
        id: "I2-borrar-la-declaracion",
        tipo: "eliminacion",
        objetivo: "repo",
        descripcion: "Se borra el `contratos.json` del módulo `empresas`.",
        esperado: {
          codigo: "unidad-sin-declaracion",
          archivo: "src/modulos/empresas/contratos.json",
          linea: 1,
        },
      },
      {
        id: "I2-noUsa-vacio",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "La declaración de `apps/plataforma` queda con `noUsa` vacío.",
        esperado: {
          codigo: "declaracion-invalida",
          archivo: "apps/plataforma/contratos.json",
          linea: 3,
          contieneMotivo: "noUsa",
        },
      },
      {
        id: "I2-usa-y-noUsa-a-la-vez",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "La declaración de `empresas` trae `usa` con un contrato y también `noUsa`.",
        esperado: {
          codigo: "declaracion-invalida",
          archivo: "src/modulos/empresas/contratos.json",
          linea: 5,
          contieneMotivo: "excluyentes",
        },
      },
      {
        id: "I2-id-inexistente",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "`apps/web` declara usar un contrato que no está en el registro.",
        esperado: {
          codigo: "declara-contrato-inexistente",
          archivo: "apps/web/contratos.json",
          linea: 5,
          contrato: "no-existe",
        },
      },
      {
        id: "I2-declaracion-fuera-de-la-raiz-de-la-unidad",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "El `contratos.json` de `src/capacidades` se mueve a una subcarpeta.",
        esperado: {
          codigo: "unidad-sin-declaracion",
          archivo: "src/capacidades/contratos.json",
          linea: 1,
        },
      },
      {
        id: "I2-id-repetido-en-usa",
        tipo: "duplicacion",
        objetivo: "repo",
        descripcion: "`empresas` declara dos veces el mismo contrato en `usa`.",
        esperado: {
          codigo: "declaracion-invalida",
          archivo: "src/modulos/empresas/contratos.json",
          linea: 2,
          contieneMotivo: "repite",
        },
      },
      {
        id: "I2-unidad-nueva-sin-declaracion",
        tipo: "desconexion",
        objetivo: "repo",
        descripcion:
          "Aparece el módulo `nuevo` (con su regla de clase) sin que nadie cree su `contratos.json`.",
        esperado: {
          codigo: "unidad-sin-declaracion",
          archivo: "src/modulos/nuevo/contratos.json",
          linea: 1,
        },
      },
      {
        id: "I2-unidad-con-solo-documentos",
        tipo: "exclusion",
        objetivo: "repo",
        descripcion:
          "Una carpeta nueva de módulo trae solo un README (clase docs, excluida): excluir el análisis no la exime de declarar.",
        esperado: {
          codigo: "unidad-sin-declaracion",
          archivo: "src/modulos/solo-docs/contratos.json",
          linea: 1,
        },
      },
      {
        id: "I2-archivo-suelto-fuera-de-toda-unidad",
        tipo: "elusion",
        objetivo: "repo",
        descripcion:
          "Un archivo con uso real se deja suelto en `apps/` (sin carpeta de app) para que ninguna unidad responda por él.",
        esperado: { codigo: "ruta-sin-clase", archivo: "apps/suelto.css", linea: 1 },
      },
    ],
  },
  {
    id: "I3",
    enunciado:
      "La declaración de cada unidad coincide con el uso real que detectan los detectores.",
    elementos: {
      aplica: [`${COMPARACION}#comparar`, `${GUARDIAN}#ejecutar (detector-sin-rutas)`],
      define: ["<unidad>/contratos.json (usa / noUsa)", "contratos.cjs#deteccion de cada contrato"],
      parametriza: [
        "detector.clases de cada detector",
        "contrato.bloqueaDeclaracionFalsa",
        "arquitectura/contratos/detectores.cjs#porPatron",
      ],
      hacePosible: [`${REGISTRO}#cargarRegistro`, "npm run guardian", `${PRUEBAS}`],
    },
    codigosDeFalla: [
      "uso-sin-declarar",
      "no-usa-falso",
      "declaracion-falsa",
      "detector-invalido",
      "registro-invalido",
    ],
    mutaciones: [
      {
        id: "I3-quitar-el-id-de-usa",
        tipo: "eliminacion",
        objetivo: "repo",
        descripcion: "`apps/web` deja de declarar `color-separador`, que sigue usando.",
        esperado: {
          codigo: "uso-sin-declarar",
          archivo: "apps/web/ui/Linea.module.css",
          linea: 1,
          contrato: "color-separador",
        },
      },
      {
        id: "I3-vaciar-el-detector",
        tipo: "eliminacion",
        objetivo: "repo",
        descripcion: "Un contrato queda sin ningún detector (regla central sin detector).",
        esperado: {
          codigo: "registro-invalido",
          archivo: "arquitectura/contratos/contratos.cjs",
          linea: 4,
          contieneMotivo: "deteccion",
        },
      },
      {
        id: "I3-noUsa-con-uso-real",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "`empresas` declara que no usa nada y sigue usando un contrato.",
        esperado: {
          codigo: "no-usa-falso",
          archivo: "src/modulos/empresas/dominio/separador.ts",
          linea: 1,
          contrato: "color-separador",
        },
      },
      {
        id: "I3-declarar-sin-uso",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "`empresas` declara un contrato que no usa.",
        esperado: {
          codigo: "declaracion-falsa",
          archivo: "src/modulos/empresas/contratos.json",
          linea: 4,
          contrato: "radio-unico",
        },
      },
      {
        id: "I3-mover-el-uso-a-una-clase-no-mirada",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion:
          "El único uso de `empresas` pasa a un archivo de pruebas, una clase que los detectores no miran.",
        esperado: {
          codigo: "declaracion-falsa",
          archivo: "src/modulos/empresas/contratos.json",
          linea: 3,
          contrato: "color-separador",
        },
      },
      {
        id: "I3-detector-que-lanza-un-error",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "El detector de uso de un contrato lanza un error al leer un archivo.",
        esperado: {
          codigo: "detector-invalido",
          archivo: "arquitectura/contratos/contratos.cjs",
          linea: 4,
          contrato: "color-separador",
        },
      },
      {
        id: "I3-detector-con-linea-fuera-del-archivo",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "El detector de uso devuelve una línea que el archivo no tiene.",
        esperado: {
          codigo: "detector-invalido",
          archivo: "arquitectura/contratos/contratos.cjs",
          linea: 4,
          contrato: "color-separador",
        },
      },
      {
        id: "I3-detector-que-nunca-reconoce",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion:
          "El detector de uso queda como una función que siempre devuelve una lista vacía.",
        esperado: {
          codigo: "declaracion-falsa",
          archivo: "src/modulos/empresas/contratos.json",
          linea: 3,
          contrato: "color-separador",
        },
      },
      {
        id: "I3-copiar-el-uso-a-una-unidad-que-no-declara",
        tipo: "duplicacion",
        objetivo: "repo",
        descripcion: "Se copia el uso a `src/capacidades`, que declara no depender de nada.",
        esperado: {
          codigo: "no-usa-falso",
          archivo: "src/capacidades/permisos/separador.ts",
          linea: 1,
          contrato: "color-separador",
        },
      },
      {
        id: "I3-desconectar-el-detector-de-las-clases-del-uso",
        tipo: "desconexion",
        objetivo: "repo",
        descripcion:
          "El detector de uso pasa a mirar solo la clase `pruebas`, donde no vive ningún uso.",
        esperado: {
          codigo: "declaracion-falsa",
          archivo: "src/modulos/empresas/contratos.json",
          linea: 3,
          contrato: "color-separador",
        },
      },
      {
        id: "I3-detector-sin-clases",
        tipo: "desconexion",
        objetivo: "repo",
        descripcion: "Un detector se registra sin ninguna clase: no leería nada.",
        esperado: {
          codigo: "registro-invalido",
          archivo: "arquitectura/contratos/contratos.cjs",
          linea: 4,
          contieneMotivo: "clases",
        },
      },
      {
        id: "I3-excluir-el-archivo-que-usa",
        tipo: "exclusion",
        objetivo: "repo",
        descripcion:
          "Se excluye (con una exclusión válida) el único archivo donde `apps/web` usa `radio-unico`.",
        esperado: {
          codigo: "declaracion-falsa",
          archivo: "apps/web/contratos.json",
          linea: 4,
          contrato: "radio-unico",
        },
      },
      {
        id: "I3-escribir-el-uso-por-un-camino-que-el-detector-no-reconoce",
        tipo: "elusion",
        objetivo: "repo",
        descripcion:
          "El uso de `radio-unico` se reescribe con espacios dentro del `var( )`, que el detector no reconoce.",
        esperado: {
          codigo: "declaracion-falsa",
          archivo: "apps/web/contratos.json",
          linea: 4,
          contrato: "radio-unico",
        },
      },
    ],
  },
  {
    id: "I4",
    enunciado: "Cada contrato tiene una única fuente de verdad.",
    elementos: {
      aplica: [`${COMPARACION}#comparar (definicion-fuera-de-la-fuente, contrato-sin-fuente)`],
      define: ["contrato.fuenteDeVerdad en contratos.cjs", "el archivo que la contiene"],
      parametriza: ["detectores de tipo `definicion` de cada contrato", "detector.clases"],
      hacePosible: [`${REGISTRO}#cargarRegistro`, "npm run guardian", `${PRUEBAS}`],
    },
    codigosDeFalla: ["definicion-fuera-de-la-fuente", "contrato-sin-fuente"],
    mutaciones: [
      {
        id: "I4-borrar-la-fuente",
        tipo: "eliminacion",
        objetivo: "repo",
        descripcion: "Se borra el archivo `tokens.css`, la fuente de verdad del contrato.",
        esperado: {
          codigo: "contrato-sin-fuente",
          archivo: "apps/web/ui/tokens.css",
          linea: 1,
          contrato: "color-separador",
        },
      },
      {
        id: "I4-cambiar-la-exportacion",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "El registro apunta a una variable que la fuente no define.",
        esperado: {
          codigo: "contrato-sin-fuente",
          archivo: "apps/web/ui/tokens.css",
          linea: 1,
          contrato: "color-separador",
          contieneMotivo: "--color-de-linea",
        },
      },
      {
        id: "I4-copiar-el-valor-en-otro-archivo",
        tipo: "duplicacion",
        objetivo: "repo",
        descripcion:
          "Se copia la definición de la variable en otra hoja de estilos de la misma app.",
        esperado: {
          codigo: "definicion-fuera-de-la-fuente",
          archivo: "apps/web/ui/Otra.module.css",
          linea: 2,
          contrato: "color-separador",
        },
      },
      {
        id: "I4-segunda-definicion-en-otra-unidad",
        tipo: "duplicacion",
        objetivo: "repo",
        descripcion: "Se define la variable también dentro de `apps/plataforma`.",
        esperado: {
          codigo: "definicion-fuera-de-la-fuente",
          archivo: "apps/plataforma/pantallas/Inicio.css",
          linea: 2,
          contrato: "color-separador",
        },
      },
      {
        id: "I4-fuente-apuntada-a-un-archivo-que-no-existe",
        tipo: "desconexion",
        objetivo: "repo",
        descripcion: "La fuente de verdad del registro apunta a un archivo que no existe.",
        esperado: {
          codigo: "contrato-sin-fuente",
          archivo: "apps/web/ui/otros-tokens.css",
          linea: 1,
          contrato: "color-separador",
        },
      },
      {
        id: "I4-quitar-el-detector-de-definicion",
        tipo: "desconexion",
        objetivo: "repo",
        descripcion:
          "Se saca del contrato el detector de `definicion` y se copia el valor en otro archivo.",
        esperado: {
          codigo: "definicion-fuera-de-la-fuente",
          archivo: "apps/web/ui/Otra.module.css",
          linea: 2,
          contrato: "color-separador",
        },
        pendiente:
          "HUECO: el registro exige al menos un detector de `uso` pero NO exige uno de `definicion`; un contrato sin él acepta copias del valor sin falla (I4 queda sin protección para ese contrato). Cierre previsto: `registro.cjs` rechaza un contrato sin detector de definición (o declara explícitamente que no tiene valor que copiar).",
      },
      {
        id: "I4-silenciar-la-copia-con-una-exclusion-vencida",
        tipo: "exclusion",
        objetivo: "repo",
        descripcion:
          "La copia del valor se intenta esconder con una exclusión de ruta ya vencida: no excluye nada.",
        esperado: {
          codigo: "definicion-fuera-de-la-fuente",
          archivo: "apps/web/ui/Otra.module.css",
          linea: 2,
          contrato: "color-separador",
        },
      },
      {
        id: "I4-definir-el-valor-por-un-camino-que-el-detector-no-conoce",
        tipo: "elusion",
        noAplica:
          "Es el límite documentado de todo detector de texto (detectores.cjs y contratos-arquitectonicos.md §3): una definición escrita de una forma que ningún detector reconoce no se ve. No es una decisión del guardián: se cubre con la prueba de navegador o de integración del contrato (G2/G3) y agregando el detector cuando aparece.",
      },
    ],
  },
  {
    id: "I5",
    enunciado:
      "Las excepciones son acotadas (un archivo, una línea) y vigentes (60 días como máximo).",
    elementos: {
      aplica: [`${EXCEPCIONES}#aplicarExcepciones`, `${EXCEPCIONES}#problemasComunes`],
      define: ["arquitectura/contratos/excepciones.json"],
      parametriza: [
        `${EXCEPCIONES}#PLAZO_MAXIMO_DIAS`,
        `${EXCEPCIONES}#DIAS_DE_AVISO`,
        `${EXCEPCIONES}#CAMPOS_DE_EXCEPCION`,
      ],
      hacePosible: ["el reloj inyectable (`ahora`)", "npm run guardian", `${PRUEBAS}`],
    },
    codigosDeFalla: [
      "excepcion-invalida",
      "excepcion-vencida",
      "excepcion-plazo-excesivo",
      "excepcion-vence-antes-de-creada",
      "excepcion-creada-futura",
      "excepcion-ruta-no-exacta",
      "excepcion-huella-cambiada",
      "excepcion-obsoleta",
      "excepcion-contrato-inexistente",
      "no-usa-falso",
    ],
    mutaciones: [
      {
        id: "I5-campo-faltante",
        tipo: "eliminacion",
        objetivo: "repo",
        descripcion: "A la excepción le falta el campo `responsable`.",
        esperado: {
          codigo: "excepcion-invalida",
          archivo: "arquitectura/contratos/excepciones.json",
          linea: 2,
          contieneMotivo: "responsable",
        },
      },
      {
        id: "I5-excepcion-obsoleta",
        tipo: "eliminacion",
        objetivo: "repo",
        descripcion: "Se elimina el uso que la excepción silenciaba y la excepción queda.",
        esperado: {
          codigo: "excepcion-obsoleta",
          archivo: "arquitectura/contratos/excepciones.json",
          linea: 3,
        },
      },
      {
        id: "I5-vencida",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "La excepción venció ayer respecto del reloj.",
        esperado: {
          codigo: "excepcion-vencida",
          archivo: "arquitectura/contratos/excepciones.json",
          linea: 11,
        },
      },
      {
        id: "I5-mas-de-60-dias",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "La excepción dura 61 días entre `creada` y `vence`.",
        esperado: {
          codigo: "excepcion-plazo-excesivo",
          archivo: "arquitectura/contratos/excepciones.json",
          linea: 11,
        },
      },
      {
        id: "I5-creada-en-el-futuro",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "La excepción dice haberse creado después de hoy.",
        esperado: {
          codigo: "excepcion-creada-futura",
          archivo: "arquitectura/contratos/excepciones.json",
          linea: 10,
        },
      },
      {
        id: "I5-vence-antes-de-creada",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "El vencimiento de la excepción es anterior a su creación.",
        esperado: {
          codigo: "excepcion-vence-antes-de-creada",
          archivo: "arquitectura/contratos/excepciones.json",
          linea: 11,
        },
      },
      {
        id: "I5-la-huella-ya-no-coincide",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "La línea silenciada cambia de texto: la huella aprobada ya no coincide.",
        esperado: {
          codigo: "excepcion-huella-cambiada",
          archivo: "arquitectura/contratos/excepciones.json",
          linea: 6,
        },
      },
      {
        id: "I5-comodin-en-la-ruta",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "La ruta de la excepción pasa a ser una carpeta con comodín.",
        esperado: {
          codigo: "excepcion-ruta-no-exacta",
          archivo: "arquitectura/contratos/excepciones.json",
          linea: 5,
        },
      },
      {
        id: "I5-ampliar-el-alcance-a-otra-linea-igual",
        tipo: "duplicacion",
        objetivo: "repo",
        descripcion:
          "El archivo suma una segunda línea idéntica a la silenciada: la excepción cubre una sola.",
        esperado: {
          codigo: "no-usa-falso",
          archivo: "src/capacidades/permisos/separador.ts",
          linea: 2,
          contrato: "color-separador",
        },
      },
      {
        id: "I5-dos-excepciones-para-un-hallazgo",
        tipo: "duplicacion",
        objetivo: "repo",
        descripcion:
          "Se copia la excepción con otro id para silenciar el mismo hallazgo dos veces.",
        esperado: {
          codigo: "excepcion-huella-cambiada",
          archivo: "arquitectura/contratos/excepciones.json",
          linea: 17,
        },
      },
      {
        id: "I5-contrato-inexistente",
        tipo: "desconexion",
        objetivo: "repo",
        descripcion: "La excepción apunta a un contrato que no está en el registro.",
        esperado: {
          codigo: "excepcion-contrato-inexistente",
          archivo: "arquitectura/contratos/excepciones.json",
          linea: 4,
          contrato: "no-existe",
        },
      },
      {
        id: "I5-excluir-las-excepciones-del-control",
        tipo: "exclusion",
        noAplica:
          "Las excepciones no tienen un mecanismo de exclusión propio: lo que no se analiza se excluye con exclusiones.json, que tiene el mismo rigor y su propia protección (I6). No existe un camino por el cual una excepción quede fuera del control de vigencia.",
      },
      {
        id: "I5-renovar-sin-aprobacion-real",
        tipo: "elusion",
        noAplica:
          "Renovar una excepción vencida con fechas nuevas y el mismo aprobador es legítimo y queda registrado en `aprobadoPor`; el guardián no puede probar quién lo escribió (contratos-arquitectonicos.md §10, límites). La traba es el Gate y que el dueño ve cada excepción nueva en el PR, no una verificación del guardián.",
      },
    ],
  },
  {
    id: "I6",
    enunciado: "Lo que no se analiza está excluido de forma explícita y temporal.",
    elementos: {
      aplica: [
        `${EXCEPCIONES}#procesarExclusiones`,
        `${GUARDIAN}#ejecutar (detector-en-clase-excluida)`,
      ],
      define: ["arquitectura/contratos/exclusiones.json"],
      parametriza: [
        `${CLASIFICACION}#CLASES_EXCLUIBLES`,
        `${EXCEPCIONES}#PLAZO_MAXIMO_DIAS`,
        `${EXCEPCIONES}#CAMPOS_DE_EXCLUSION_DE_CLASE`,
      ],
      hacePosible: [
        "el informe (`exclusiones`, `clases[*].excluidas`)",
        "npm run guardian",
        `${PRUEBAS}`,
      ],
    },
    codigosDeFalla: [
      "excepcion-invalida",
      "excepcion-vencida",
      "excepcion-plazo-excesivo",
      "excepcion-ruta-no-exacta",
      "excepcion-huella-cambiada",
      "excepcion-obsoleta",
      "detector-en-clase-excluida",
    ],
    mutaciones: [
      {
        id: "I6-exclusion-sin-motivo",
        tipo: "eliminacion",
        objetivo: "repo",
        descripcion: "A una exclusión de clase le falta el `motivo`.",
        esperado: {
          codigo: "excepcion-invalida",
          archivo: "arquitectura/contratos/exclusiones.json",
          linea: 2,
          contieneMotivo: "motivo",
        },
      },
      {
        id: "I6-vaciar-las-exclusiones",
        tipo: "eliminacion",
        objetivo: "repo",
        descripcion:
          "Se vacía `exclusiones.json`: se analiza más, y eso NO es una falla (el guardián solo exige explicitar lo que se deja afuera).",
        esperado: { pasa: true },
      },
      {
        id: "I6-exclusion-sin-aprobacion",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "Una exclusión queda con `aprobadoPor` vacío.",
        esperado: {
          codigo: "excepcion-invalida",
          archivo: "arquitectura/contratos/exclusiones.json",
          linea: 8,
          contieneMotivo: "aprobadoPor",
        },
      },
      {
        id: "I6-excluir-una-clase-no-permitida",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "Una exclusión saca del análisis la clase `backend`.",
        esperado: {
          codigo: "excepcion-invalida",
          archivo: "arquitectura/contratos/exclusiones.json",
          linea: 5,
          contieneMotivo: "backend",
        },
      },
      {
        id: "I6-exclusion-vencida",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "La exclusión de `docs` venció respecto del reloj.",
        esperado: {
          codigo: "excepcion-vencida",
          archivo: "arquitectura/contratos/exclusiones.json",
          linea: 20,
        },
      },
      {
        id: "I6-exclusion-de-mas-de-60-dias",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "La exclusión de `generado` dura más de 60 días.",
        esperado: {
          codigo: "excepcion-plazo-excesivo",
          archivo: "arquitectura/contratos/exclusiones.json",
          linea: 10,
        },
      },
      {
        id: "I6-misma-clase-excluida-dos-veces",
        tipo: "duplicacion",
        objetivo: "repo",
        descripcion: "La clase `generado` se excluye con dos entradas.",
        esperado: {
          codigo: "excepcion-invalida",
          archivo: "arquitectura/contratos/exclusiones.json",
          linea: 25,
          contieneMotivo: "ya está excluida",
        },
      },
      {
        id: "I6-exclusion-de-un-archivo-que-ya-no-existe",
        tipo: "desconexion",
        objetivo: "repo",
        descripcion: "Una exclusión de archivo apunta a una ruta que ya no está versionada.",
        esperado: {
          codigo: "excepcion-obsoleta",
          archivo: "arquitectura/contratos/exclusiones.json",
          linea: 23,
        },
      },
      {
        id: "I6-detector-sobre-una-clase-excluida",
        tipo: "desconexion",
        objetivo: "repo",
        descripcion: "Un detector declara la clase `docs`, que está excluida: nunca vería nada.",
        esperado: {
          codigo: "detector-en-clase-excluida",
          archivo: "arquitectura/contratos/contratos.cjs",
          linea: 4,
          contrato: "color-separador",
        },
      },
      {
        id: "I6-exclusion-de-archivo-con-la-huella-vieja",
        tipo: "exclusion",
        objetivo: "repo",
        descripcion:
          "Se excluye un archivo exacto con la huella de una versión anterior: el archivo cambió después de aprobarse.",
        esperado: {
          codigo: "excepcion-huella-cambiada",
          archivo: "arquitectura/contratos/exclusiones.json",
          linea: 26,
        },
      },
      {
        id: "I6-exclusion-con-comodin",
        tipo: "elusion",
        objetivo: "repo",
        descripcion:
          "Se intenta esquivar el análisis de `apps/web` con una exclusión de ruta con comodín.",
        esperado: {
          codigo: "excepcion-ruta-no-exacta",
          archivo: "arquitectura/contratos/exclusiones.json",
          linea: 25,
        },
      },
    ],
  },
  {
    id: "I7",
    enunciado: "«Pasó» significa «se analizó algo».",
    elementos: {
      aplica: [
        `${GUARDIAN}#ejecutar (sin-rutas, clase-sin-rutas, detector-sin-rutas)`,
        `${COMPARACION}#comparar (ruta-ilegible)`,
        `${MECANISMO}#verificarInformeDeEvidencia`,
      ],
      define: ["arquitectura/contratos/informe.json (evidencia de cada corrida)"],
      parametriza: [`${CLASIFICACION}#CLASES_ESPERADAS`, "detector.clases"],
      hacePosible: ["`git ls-files` (cargarDelRepo)", "npm run guardian", `${PRUEBAS}`],
    },
    codigosDeFalla: [
      "sin-rutas",
      "clase-sin-rutas",
      "detector-sin-rutas",
      "ruta-ilegible",
      "informe-sin-evidencia",
    ],
    mutaciones: [
      {
        id: "I7-repositorio-sin-archivos",
        tipo: "eliminacion",
        objetivo: "repo",
        descripcion: "`git ls-files` no devuelve ninguna ruta.",
        esperado: { codigo: "sin-rutas", archivo: CLASIFICACION, linea: 2 },
      },
      {
        id: "I7-clase-esperada-vacia",
        tipo: "eliminacion",
        objetivo: "repo",
        descripcion: "Se borran todos los archivos de la clase `pruebas`.",
        esperado: {
          codigo: "clase-sin-rutas",
          archivo: CLASIFICACION,
          linea: 11,
          contieneMotivo: "«pruebas»",
        },
      },
      {
        id: "I7-archivo-ilegible",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "Un archivo que un detector debe analizar no se puede leer.",
        esperado: { codigo: "ruta-ilegible", archivo: "apps/web/ui/Caja.module.css", linea: 1 },
      },
      {
        id: "I7-detector-sobre-clase-sin-texto",
        tipo: "desconexion",
        objetivo: "repo",
        descripcion:
          "Un detector queda apuntando a la clase `pruebas` y esa clase solo tiene archivos binarios.",
        esperado: {
          codigo: "detector-sin-rutas",
          archivo: "arquitectura/contratos/contratos.cjs",
          linea: 4,
          contrato: "color-separador",
        },
      },
      {
        id: "I7-excluir-todos-los-archivos-del-detector",
        tipo: "exclusion",
        objetivo: "repo",
        descripcion:
          "Se excluyen a mano todos los archivos de la clase `frontend`: los detectores no analizarían ninguno.",
        esperado: {
          codigo: "detector-sin-rutas",
          archivo: "arquitectura/contratos/contratos.cjs",
          linea: 4,
          contrato: "color-separador",
        },
      },
      {
        id: "I7-informe-sin-reglas-ejecutadas",
        tipo: "elusion",
        objetivo: "informe",
        descripcion: "El informe de una corrida «que pasa» no lista las reglas que ejecutó.",
        esperado: {
          codigo: "informe-sin-evidencia",
          archivo: "arquitectura/contratos/informe.json",
          linea: 1,
        },
      },
      {
        id: "I7-duplicar-rutas",
        tipo: "duplicacion",
        noAplica:
          "El guardián deduplica las rutas (`new Set`): listar una ruta dos veces no cambia qué se analiza ni permite pasar con menos cobertura; no existe un camino de duplicación que haga pasar sin analizar.",
      },
    ],
  },
  {
    id: "I8",
    enunciado: "El registro de contratos es válido y no se debilita en silencio.",
    elementos: {
      aplica: [`${REGISTRO}#cargarRegistro`, `${GUARDIAN}#ejecutar (registro-invalido)`],
      define: ["arquitectura/contratos/contratos.cjs", `${REGISTRO}#CAMPOS_DEL_CONTRATO`],
      parametriza: [`${REGISTRO}#PATRON_DE_ID`, `${REGISTRO}#PATRON_DE_VERSION`],
      hacePosible: [
        "comparación con `main` (--base, no-debilitar.cjs: paso paralelo de G1c)",
        "npm run guardian",
        `${PRUEBAS}`,
      ],
    },
    codigosDeFalla: ["registro-invalido", "declara-contrato-inexistente"],
    mutaciones: [
      {
        id: "I8-campo-del-contrato-faltante",
        tipo: "eliminacion",
        objetivo: "repo",
        descripcion: "Al contrato le falta el campo `protege`.",
        esperado: {
          codigo: "registro-invalido",
          archivo: "arquitectura/contratos/contratos.cjs",
          linea: 4,
          contieneMotivo: "protege",
        },
      },
      {
        id: "I8-contrato-borrado-con-unidades-que-lo-declaran",
        tipo: "eliminacion",
        objetivo: "repo",
        descripcion:
          "Se borra `color-separador` del registro mientras `apps/web` y `empresas` lo declaran.",
        esperado: {
          codigo: "declara-contrato-inexistente",
          archivo: "apps/web/contratos.json",
          linea: 3,
          contrato: "color-separador",
        },
      },
      {
        id: "I8-contrato-borrado-junto-con-todas-sus-declaraciones",
        tipo: "eliminacion",
        objetivo: "repo",
        descripcion:
          "Se borra el contrato del registro y también su id de todas las declaraciones: el árbol queda coherente.",
        esperado: {
          codigo: "contrato-retirado-sin-registro",
          archivo: "arquitectura/contratos/contratos.cjs",
          linea: 1,
        },
        pendiente:
          "HUECO: con un solo árbol no se puede ver que un contrato desapareció junto con sus declaraciones; lo detecta la comparación con `main` (opción `--base` del guardián y `no-debilitar.cjs`, a cargo del paso paralelo de G1c). Cuando esa comparación exista, esta mutación pasa a correr contra una base y se saca la marca; el código esperado es provisorio.",
      },
      {
        id: "I8-version-mal-formada",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "La versión del contrato deja de tener forma MAYOR.MENOR.PARCHE.",
        esperado: {
          codigo: "registro-invalido",
          archivo: "arquitectura/contratos/contratos.cjs",
          linea: 4,
          contieneMotivo: "version",
        },
      },
      {
        id: "I8-id-de-contrato-repetido",
        tipo: "duplicacion",
        objetivo: "repo",
        descripcion: "El mismo contrato se registra dos veces.",
        esperado: {
          codigo: "registro-invalido",
          archivo: "arquitectura/contratos/contratos.cjs",
          linea: 4,
          contieneMotivo: "repetido",
        },
      },
      {
        id: "I8-detector-que-no-es-una-funcion",
        tipo: "desconexion",
        objetivo: "repo",
        descripcion: "El detector queda con `reconoce` como un texto en vez de una función.",
        esperado: {
          codigo: "registro-invalido",
          archivo: "arquitectura/contratos/contratos.cjs",
          linea: 4,
          contieneMotivo: "función",
        },
      },
      {
        id: "I8-excluir-el-registro-del-analisis",
        tipo: "exclusion",
        noAplica:
          "El registro (`contratos.cjs`) es de la clase config y las únicas clases que se pueden excluir son generado y docs (I6): no hay forma válida de excluirlo, y su validación no depende de la exclusión de archivos (se carga y valida siempre).",
      },
      {
        id: "I8-registro-vaciado-con-unidades-que-declaran",
        tipo: "elusion",
        objetivo: "repo",
        descripcion:
          "El registro queda vacío (`[]`) mientras las unidades siguen declarando `usa`.",
        esperado: {
          codigo: "declara-contrato-inexistente",
          archivo: "apps/web/contratos.json",
          linea: 3,
          contrato: "color-separador",
        },
      },
    ],
  },
  {
    id: "I9",
    enunciado: "El guardián corre y bloquea en CI.",
    elementos: {
      aplica: [`${MECANISMO}#verificarScriptsDeArquitectura`, `${MECANISMO}#verificarWorkflowDeCi`],
      define: [
        "package.json (scripts `arquitectura`, `guardian`, `gate`, `test`)",
        `${CI} (trabajos que corren el guardián y las pruebas, y trabajo \`gate\`)`,
      ],
      parametriza: [
        `${MECANISMO}#SALTOS_PERMITIDOS`,
        `${MECANISMO}#PRUEBAS_DEL_GUARDIAN`,
        "vitest.config.ts (proyecto `node`, `include`)",
      ],
      hacePosible: [
        "arquitectura/evaluar-gate.cjs",
        "test/arquitectura/gate-coincide-con-ci.test.ts (paso paralelo de G1c)",
        `${MECANISMO}#evaluarCanario`,
        `${PRUEBAS}`,
      ],
    },
    codigosDeFalla: [
      "script-arquitectura-sin-guardian",
      "script-guardian-debilitado",
      "script-gate-sin-arquitectura",
      "script-test-sin-proyecto-node",
      "ci-sin-job-gate",
      "ci-gate-sin-always",
      "ci-guardian-no-corre",
      "ci-pruebas-no-corren",
      "ci-job-fuera-del-gate",
      "ci-job-sin-tope",
      "ci-continue-on-error",
      "ci-job-desactivado",
      "ci-job-condicionado",
      "ci-disparador-incompleto",
      "ci-comando-tolerante",
      "vitest-excluye-pruebas",
      "vitest-sin-pruebas-del-guardian",
      "vitest-sin-proyecto-node",
      "prueba-saltada",
      "pruebas-del-guardian-borradas",
      "canario-pasa-un-repo-roto",
      "canario-sin-diagnostico",
      "package-json-ilegible",
    ],
    mutaciones: [
      {
        id: "I9-quitar-guardian-del-script-arquitectura",
        tipo: "eliminacion",
        objetivo: "package-json",
        descripcion: "Se quita `&& npm run guardian` del script `arquitectura`.",
        esperado: {
          codigo: "script-arquitectura-sin-guardian",
          archivo: "package.json",
          lineaDe: '"arquitectura":',
        },
      },
      {
        id: "I9-quitar-un-job-de-needs",
        tipo: "eliminacion",
        objetivo: "workflow",
        descripcion: "El trabajo `pruebas` sale de `needs` del Gate.",
        esperado: {
          codigo: "ci-job-fuera-del-gate",
          archivo: CI,
          lineaDe: { texto: "needs:", despuesDe: "  gate:" },
        },
      },
      {
        id: "I9-quitar-el-tope-de-tiempo",
        tipo: "eliminacion",
        objetivo: "workflow",
        descripcion: "El trabajo `pruebas` pierde su `timeout-minutes`.",
        esperado: { codigo: "ci-job-sin-tope", archivo: CI, lineaDe: "  pruebas:" },
      },
      {
        id: "I9-ningun-trabajo-corre-el-guardian",
        tipo: "eliminacion",
        objetivo: "workflow",
        descripcion: "Todos los pasos que corren el guardián pasan a ser un `echo`.",
        esperado: { codigo: "ci-guardian-no-corre", archivo: CI, lineaDe: "jobs:" },
      },
      {
        id: "I9-ningun-trabajo-corre-las-pruebas",
        tipo: "eliminacion",
        objetivo: "workflow",
        descripcion:
          "El paso que corre `npm test` pasa a ser un `echo`: la matriz no se ejecutaría en CI.",
        esperado: { codigo: "ci-pruebas-no-corren", archivo: CI, lineaDe: "jobs:" },
      },
      {
        id: "I9-borrar-una-prueba-del-guardian",
        tipo: "eliminacion",
        objetivo: "pruebas-del-guardian",
        descripcion: "Se borra `guardian-nucleo.test.ts`.",
        esperado: {
          codigo: "pruebas-del-guardian-borradas",
          archivo: "test/arquitectura/guardian-nucleo.test.ts",
          linea: 1,
        },
      },
      {
        id: "I9-prueba-del-guardian-pendiente",
        tipo: "eliminacion",
        objetivo: "pruebas-del-guardian",
        descripcion: "Una prueba del guardián se convierte en `todo`.",
        esperado: {
          codigo: "prueba-saltada",
          archivo: "test/arquitectura/guardian-registro.test.ts",
          lineaDe: "marca-de-la-matriz",
        },
      },
      {
        id: "I9-package-json-roto",
        tipo: "alteracion",
        objetivo: "package-json",
        descripcion:
          "El package.json queda truncado: no es JSON válido y no se puede comprobar nada.",
        esperado: { codigo: "package-json-ilegible", archivo: "package.json", linea: 1 },
      },
      {
        id: "I9-guardian-que-no-bloquea",
        tipo: "alteracion",
        objetivo: "package-json",
        descripcion: "El script `guardian` termina en `|| true`.",
        esperado: {
          codigo: "script-guardian-debilitado",
          archivo: "package.json",
          lineaDe: "|| true",
        },
      },
      {
        id: "I9-continue-on-error",
        tipo: "alteracion",
        objetivo: "workflow",
        descripcion: "El trabajo `pruebas` se marca `continue-on-error: true`.",
        esperado: {
          codigo: "ci-continue-on-error",
          archivo: CI,
          lineaDe: "continue-on-error: true",
        },
      },
      {
        id: "I9-job-con-if-false",
        tipo: "alteracion",
        objetivo: "workflow",
        descripcion: "El trabajo `pruebas` queda con `if: false`.",
        esperado: { codigo: "ci-job-desactivado", archivo: CI, lineaDe: "if: false" },
      },
      {
        id: "I9-comando-que-nunca-falla",
        tipo: "alteracion",
        objetivo: "workflow",
        descripcion: "El paso que corre las pruebas termina en `|| true`.",
        esperado: { codigo: "ci-comando-tolerante", archivo: CI, lineaDe: "npm test || true" },
      },
      {
        id: "I9-gate-sin-always",
        tipo: "alteracion",
        objetivo: "workflow",
        descripcion: "El Gate pierde `if: always()`: se saltearía cuando algo falla.",
        esperado: { codigo: "ci-gate-sin-always", archivo: CI, lineaDe: "  gate:" },
      },
      {
        id: "I9-vitest-deja-de-incluir-test",
        tipo: "alteracion",
        objetivo: "vitest-config",
        descripcion: "El proyecto de Node de Vitest deja de incluir `test/**/*.test.ts`.",
        esperado: {
          codigo: "vitest-sin-pruebas-del-guardian",
          archivo: "vitest.config.ts",
          lineaDe: 'include: ["src/**/*.test.ts"]',
        },
      },
      {
        id: "I9-prueba-del-guardian-exclusiva",
        tipo: "alteracion",
        objetivo: "pruebas-del-guardian",
        descripcion: "Una prueba del guardián se marca `only`: las demás no correrían.",
        esperado: {
          codigo: "prueba-saltada",
          archivo: "test/arquitectura/guardian-excepciones.test.ts",
          lineaDe: "marca-de-la-matriz",
        },
      },
      {
        id: "I9-script-guardian-duplicado",
        tipo: "duplicacion",
        objetivo: "package-json",
        descripcion:
          "El script `guardian` se escribe dos veces; en JSON gana la última, que no corre nada.",
        esperado: {
          codigo: "script-guardian-debilitado",
          archivo: "package.json",
          lineaDe: '"guardian": "echo guardián omitido"',
        },
      },
      {
        id: "I9-quitar-arquitectura-del-gate",
        tipo: "desconexion",
        objetivo: "package-json",
        descripcion: "El script `gate` deja de encadenar `npm run arquitectura`.",
        esperado: {
          codigo: "script-gate-sin-arquitectura",
          archivo: "package.json",
          lineaDe: '"gate":',
        },
      },
      {
        id: "I9-test-sin-el-proyecto-node",
        tipo: "desconexion",
        objetivo: "package-json",
        descripcion: "El script `test` corre el proyecto de componentes en vez del de Node.",
        esperado: {
          codigo: "script-test-sin-proyecto-node",
          archivo: "package.json",
          lineaDe: '"test":',
        },
      },
      {
        id: "I9-renombrar-el-gate",
        tipo: "desconexion",
        objetivo: "workflow",
        descripcion: "El trabajo `gate` se renombra: nada exige que los demás pasen.",
        esperado: { codigo: "ci-sin-job-gate", archivo: CI, lineaDe: "jobs:" },
      },
      {
        id: "I9-saltar-con-una-condicion-nueva",
        tipo: "desconexion",
        objetivo: "pruebas-del-guardian",
        descripcion: "Una prueba del guardián se condiciona con un `skipIf` que no está permitido.",
        esperado: {
          codigo: "prueba-saltada",
          archivo: "test/arquitectura/guardian-diagnostico.test.ts",
          lineaDe: "marca-de-la-matriz",
        },
      },
      {
        id: "I9-constante-de-salto-forzada",
        tipo: "desconexion",
        objetivo: "pruebas-del-guardian",
        descripcion:
          "La constante `SIN_GIT` pasa a ser `true`: el salto permitido saltearía todo siempre.",
        esperado: {
          codigo: "prueba-saltada",
          archivo: "test/arquitectura/guardian-nucleo.test.ts",
          lineaDe: "const describeConGit = describe.skipIf(SIN_GIT);",
        },
      },
      {
        id: "I9-excluir-las-pruebas-del-guardian-en-vitest",
        tipo: "exclusion",
        objetivo: "vitest-config",
        descripcion: 'Se agrega `exclude: ["test/arquitectura/guardian-*"]` al proyecto de Node.',
        esperado: {
          codigo: "vitest-excluye-pruebas",
          archivo: "vitest.config.ts",
          lineaDe: "exclude:",
        },
      },
      {
        id: "I9-job-solo-en-un-evento",
        tipo: "exclusion",
        objetivo: "workflow",
        descripcion:
          "El trabajo `pruebas` pasa a correr solo en `workflow_dispatch`: nunca correría en un pull request.",
        esperado: { codigo: "ci-job-condicionado", archivo: CI, lineaDe: "workflow_dispatch" },
      },
      {
        id: "I9-sin-disparador-de-pull-request",
        tipo: "eliminacion",
        objetivo: "workflow",
        descripcion: "El workflow deja de correr en `pull_request`.",
        esperado: { codigo: "ci-disparador-incompleto", archivo: CI, lineaDe: "on:" },
      },
      {
        id: "I9-disparador-con-filtro-de-rutas",
        tipo: "alteracion",
        objetivo: "workflow",
        descripcion:
          "`pull_request` se filtra con `paths-ignore`: algunos cambios no pasarían por el Gate.",
        esperado: { codigo: "ci-disparador-incompleto", archivo: CI, lineaDe: "paths-ignore" },
      },
      {
        id: "I9-renombrar-el-proyecto-node",
        tipo: "desconexion",
        objetivo: "vitest-config",
        descripcion:
          'El proyecto de Node de Vitest deja de llamarse "node": `--project node` no encuentra nada.',
        esperado: {
          codigo: "vitest-sin-proyecto-node",
          archivo: "vitest.config.ts",
          lineaDe: "projects:",
        },
      },
      {
        id: "I9-guardian-que-sale-0-sin-analizar",
        tipo: "elusion",
        objetivo: "canario",
        descripcion: "`guardian.cjs` se reemplaza por un archivo que sale con 0 sin analizar nada.",
        esperado: { codigo: "canario-pasa-un-repo-roto", archivo: GUARDIAN, linea: 1 },
      },
      {
        id: "I9-guardian-que-rechaza-sin-diagnostico",
        tipo: "elusion",
        objetivo: "canario",
        descripcion: "`guardian.cjs` se reemplaza por un archivo que sale con 1 sin decir por qué.",
        esperado: { codigo: "canario-sin-diagnostico", archivo: GUARDIAN, linea: 1 },
      },
      {
        id: "I9-guardian-que-no-ve-las-rutas-sin-clase",
        tipo: "elusion",
        objetivo: "canario",
        descripcion:
          "Una copia del guardián real con el chequeo de ruta sin clase apagado: sale distinto de 0 por otras fallas pero no diagnostica el repo roto conocido.",
        esperado: { codigo: "canario-sin-diagnostico", archivo: GUARDIAN, linea: 1 },
      },
      {
        id: "I9-saltar-una-prueba-del-guardian",
        tipo: "elusion",
        objetivo: "pruebas-del-guardian",
        descripcion: "Una prueba del guardián se marca `skip`.",
        esperado: {
          codigo: "prueba-saltada",
          archivo: "test/arquitectura/guardian-clasificacion.test.ts",
          lineaDe: "marca-de-la-matriz",
        },
      },
    ],
  },
  {
    id: "I10",
    enunciado:
      "La matriz está completa y conectada: sin huecos entre lo que el guardián puede decir y lo que se prueba.",
    elementos: {
      aplica: [
        `${ARCHIVO_DE_LA_MATRIZ}#comprobarMatriz`,
        `${GUARDIAN}#comprobarUbicaciones (falla-sin-ubicacion, codigo-fuera-de-la-lista)`,
      ],
      define: [ARCHIVO_DE_LA_MATRIZ, "arquitectura/contratos/codigos.cjs#CODIGOS_DE_FALLA"],
      parametriza: [
        `${ARCHIVO_DE_LA_MATRIZ}#TIPOS_DE_MUTACION`,
        `${ARCHIVO_DE_LA_MATRIZ}#IDS_DE_INVARIANTES`,
      ],
      hacePosible: [
        "test/arquitectura/guardian-matriz.test.ts",
        `${MECANISMO}#escanearPruebasDelGuardian`,
        `${MECANISMO}#verificarVitestConfig`,
        `${CI} (job pruebas, requerido por el Gate)`,
      ],
    },
    codigosDeFalla: [
      "falla-sin-ubicacion",
      "codigo-fuera-de-la-lista",
      "matriz-invariante-mal-formado",
      "matriz-invariante-ausente",
      "matriz-mutacion-mal-formada",
      "matriz-codigo-desconocido",
      "matriz-codigo-sin-invariante",
      "matriz-codigo-sin-mutacion",
      "matriz-invariante-sin-tipos",
      "matriz-noaplica-sin-motivo",
      "matriz-id-repetido",
      "matriz-mutacion-sin-aplicador",
      "matriz-aplicador-huerfano",
      "vitest-excluye-pruebas",
      "prueba-saltada",
    ],
    mutaciones: [
      {
        id: "I10-quitar-las-mutaciones-de-un-tipo",
        tipo: "eliminacion",
        objetivo: "matriz",
        descripcion: "Se quitan del catálogo todas las mutaciones de tipo `eliminacion` de I2.",
        esperado: {
          codigo: "matriz-invariante-sin-tipos",
          archivo: ARCHIVO_DE_LA_MATRIZ,
          lineaDe: 'id: "I2",',
          contieneMotivo: "eliminacion",
        },
      },
      {
        id: "I10-agregar-un-codigo-sin-invariante",
        tipo: "alteracion",
        objetivo: "matriz",
        descripcion: "Se agrega a `CODIGOS_DE_FALLA` un código que ningún invariante nombra.",
        esperado: {
          codigo: "matriz-codigo-sin-invariante",
          archivo: ARCHIVO_DE_LA_MATRIZ,
          lineaDe: "const INVARIANTES",
          contieneMotivo: "chequeo-nuevo-sin-invariante",
        },
      },
      {
        id: "I10-codigo-sin-mutacion-que-lo-espere",
        tipo: "alteracion",
        objetivo: "matriz",
        descripcion:
          "Se quitan todas las mutaciones que esperan `uso-sin-declarar`: el código sigue en I3 pero nada lo prueba.",
        esperado: {
          codigo: "matriz-codigo-sin-mutacion",
          archivo: ARCHIVO_DE_LA_MATRIZ,
          lineaDe: "const INVARIANTES",
          contieneMotivo: "uso-sin-declarar",
        },
      },
      {
        id: "I10-borrar-un-invariante",
        tipo: "eliminacion",
        objetivo: "matriz",
        descripcion: "Se borra el invariante I7 del catálogo.",
        esperado: {
          codigo: "matriz-invariante-ausente",
          archivo: ARCHIVO_DE_LA_MATRIZ,
          lineaDe: "const INVARIANTES",
          contieneMotivo: "I7",
        },
      },
      {
        id: "I10-invariante-sin-elementos",
        tipo: "alteracion",
        objetivo: "matriz",
        descripcion: "Un invariante pierde la lista de elementos que lo definen.",
        esperado: {
          codigo: "matriz-invariante-mal-formado",
          archivo: ARCHIVO_DE_LA_MATRIZ,
          lineaDe: 'id: "I3",',
          contieneMotivo: "elementos.define",
        },
      },
      {
        id: "I10-mutacion-sin-esperado",
        tipo: "alteracion",
        objetivo: "matriz",
        descripcion: "Una mutación pierde su `esperado`: no diría qué tiene que fallar.",
        esperado: {
          codigo: "matriz-mutacion-mal-formada",
          archivo: ARCHIVO_DE_LA_MATRIZ,
          lineaDe: 'id: "I1",',
          contieneMotivo: "esperado",
        },
      },
      {
        id: "I10-invariante-con-codigo-inexistente",
        tipo: "alteracion",
        objetivo: "matriz",
        descripcion: "Un invariante nombra un código que ningún chequeo emite.",
        esperado: {
          codigo: "matriz-codigo-desconocido",
          archivo: ARCHIVO_DE_LA_MATRIZ,
          lineaDe: 'id: "I1",',
          contieneMotivo: "codigo-que-no-existe",
        },
      },
      {
        id: "I10-noaplica-sin-motivo",
        tipo: "alteracion",
        objetivo: "matriz",
        descripcion: "Un `noAplica` queda con el motivo vacío.",
        esperado: {
          codigo: "matriz-noaplica-sin-motivo",
          archivo: ARCHIVO_DE_LA_MATRIZ,
          lineaDe: 'id: "I4",',
        },
      },
      {
        id: "I10-hallazgo-sin-linea",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion:
          "Un chequeo nuevo emite una falla con archivo pero sin línea ni forma de calcularla.",
        esperado: {
          codigo: "falla-sin-ubicacion",
          archivo: "src/chequeo-nuevo.ts",
          linea: 1,
        },
      },
      {
        id: "I10-codigo-fuera-de-la-lista-cerrada",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion:
          "Un chequeo nuevo emite una falla con un código que no está en la lista cerrada.",
        esperado: {
          codigo: "codigo-fuera-de-la-lista",
          archivo: "src/chequeo-nuevo.ts",
          linea: 1,
        },
      },
      {
        id: "I10-id-de-mutacion-repetido",
        tipo: "duplicacion",
        objetivo: "matriz",
        descripcion: "Dos mutaciones del catálogo comparten el mismo id.",
        esperado: {
          codigo: "matriz-id-repetido",
          archivo: ARCHIVO_DE_LA_MATRIZ,
          lineaDe: 'id: "I1-quitar-la-regla-de-una-carpeta"',
        },
      },
      {
        id: "I10-mutacion-sin-aplicador",
        tipo: "desconexion",
        objetivo: "matriz",
        descripcion: "Una mutación del catálogo queda sin su aplicador en las pruebas.",
        esperado: {
          codigo: "matriz-mutacion-sin-aplicador",
          archivo: ARCHIVO_DE_LA_MATRIZ,
          lineaDe: 'id: "I1-quitar-la-regla-de-una-carpeta"',
        },
      },
      {
        id: "I10-aplicador-sin-mutacion",
        tipo: "desconexion",
        objetivo: "matriz",
        descripcion:
          "Queda en las pruebas un aplicador de una mutación que el catálogo ya no declara.",
        esperado: {
          codigo: "matriz-aplicador-huerfano",
          archivo: ARCHIVO_DE_LA_MATRIZ,
          lineaDe: "const INVARIANTES",
          contieneMotivo: "mutacion-que-ya-no-existe",
        },
      },
      {
        id: "I10-excluir-la-matriz-en-vitest",
        tipo: "exclusion",
        objetivo: "vitest-config",
        descripcion:
          'Se agrega `exclude: ["test/arquitectura/guardian-matriz*"]` al proyecto de Node.',
        esperado: {
          codigo: "vitest-excluye-pruebas",
          archivo: "vitest.config.ts",
          lineaDe: "exclude:",
        },
      },
      {
        id: "I10-saltar-la-matriz",
        tipo: "elusion",
        objetivo: "pruebas-del-guardian",
        descripcion: "Una prueba de la propia matriz se marca `skip`.",
        esperado: {
          codigo: "prueba-saltada",
          archivo: "test/arquitectura/guardian-matriz.test.ts",
          lineaDe: "marca-de-la-matriz",
        },
      },
    ],
  },
];

/** La primera línea (desde 1) del texto que contiene `buscado`; 1 si no está. */
function lineaDe(texto, buscado) {
  const indice = texto.split(/\r\n|\n/).findIndex((linea) => linea.includes(buscado));
  return indice === -1 ? 1 : indice + 1;
}

const esTextoNoVacio = (valor) => typeof valor === "string" && valor.trim() !== "";
const esObjeto = (valor) => typeof valor === "object" && valor !== null && !Array.isArray(valor);

/** Los códigos que un invariante conoce y puede nombrar: los del guardián y los de los verificadores. */
function codigosConocidos(codigosDeFalla) {
  return new Set([...codigosDeFalla, ...CODIGOS_DE_MECANISMO]);
}

/** Las mutaciones que se ejecutan (no `noAplica`) de un invariante. */
const ejecutables = (invariante) => invariante.mutaciones.filter((m) => m.noAplica === undefined);

/** Los huecos abiertos: mutaciones marcadas `pendiente` (hoy sobreviven). */
function huecosAbiertos(invariantes = INVARIANTES) {
  return invariantes.flatMap((invariante) =>
    invariante.mutaciones
      .filter((m) => m.pendiente !== undefined)
      .map((m) => ({ invariante: invariante.id, mutacion: m.id, motivo: m.pendiente })),
  );
}

/**
 * Comprueba los meta-invariantes M1, M2 y M5 (y la forma del catálogo) sobre una matriz dada. Puro:
 * recibe la matriz, los códigos de falla del guardián, los ids de mutación que tienen aplicador y,
 * opcionalmente, el texto de este archivo para ubicar cada problema en una línea. Devuelve problemas
 * `{ codigo, archivo, linea, motivo, correccion }`; vacío = la matriz está completa y conectada.
 *
 * @param {{ invariantes: readonly object[], codigosDeFalla: readonly string[],
 *   idsConAplicador: Iterable<string>, texto?: string }} datos
 */
function comprobarMatriz({ invariantes, codigosDeFalla, idsConAplicador, texto = "" }) {
  const problemas = [];
  const nuevo = (codigo, buscado, motivo, correccion) =>
    problemas.push({
      codigo,
      archivo: ARCHIVO_DE_LA_MATRIZ,
      linea: lineaDe(texto, buscado),
      motivo,
      correccion,
    });
  const conAplicador = new Set(idsConAplicador);
  const conocidos = codigosConocidos(codigosDeFalla);
  const idsVistos = new Set();
  const todas = [];

  for (const id of IDS_DE_INVARIANTES) {
    if (!invariantes.some((i) => i.id === id)) {
      nuevo(
        "matriz-invariante-ausente",
        "const INVARIANTES",
        `Falta el invariante ${id} en la matriz.`,
        "Restituí el invariante: la matriz tiene que cubrir I1 a I10.",
      );
    }
  }
  for (const invariante of invariantes) {
    const donde = `id: "${invariante.id}",`;
    const defectos = [];
    if (!esTextoNoVacio(invariante.id)) defectos.push("falta el id");
    if (!esTextoNoVacio(invariante.enunciado)) defectos.push("falta el enunciado");
    for (const clave of CLAVES_DE_ELEMENTOS) {
      const lista = invariante.elementos?.[clave];
      if (!Array.isArray(lista) || lista.length === 0 || !lista.every(esTextoNoVacio)) {
        defectos.push(`«elementos.${clave}» tiene que ser una lista de textos no vacía`);
      }
    }
    if (!Array.isArray(invariante.codigosDeFalla) || invariante.codigosDeFalla.length === 0) {
      defectos.push("«codigosDeFalla» está vacío");
    }
    if (!Array.isArray(invariante.mutaciones) || invariante.mutaciones.length === 0) {
      defectos.push("no tiene mutaciones");
    }
    if (defectos.length > 0) {
      nuevo(
        "matriz-invariante-mal-formado",
        donde,
        `El invariante ${String(invariante.id)} está mal formado: ${defectos.join("; ")}.`,
        "Completá el invariante con enunciado, elementos, códigos de falla y mutaciones.",
      );
      continue;
    }
    for (const codigo of invariante.codigosDeFalla) {
      if (!conocidos.has(codigo)) {
        nuevo(
          "matriz-codigo-desconocido",
          donde,
          `${invariante.id} nombra el código «${codigo}», que no existe en el guardián ni en los verificadores.`,
          "Corregí el código o sumalo a codigos.cjs / verificar-mecanismo.cjs.",
        );
      }
    }
    for (const mutacion of invariante.mutaciones) {
      todas.push({ invariante, mutacion });
      const defectosDeLaMutacion = [];
      if (!esTextoNoVacio(mutacion.id)) defectosDeLaMutacion.push("falta el id");
      if (!TIPOS_DE_MUTACION.includes(mutacion.tipo)) defectosDeLaMutacion.push("tipo inválido");
      if (mutacion.noAplica === undefined) {
        if (!esTextoNoVacio(mutacion.descripcion))
          defectosDeLaMutacion.push("falta la descripción");
        if (!OBJETIVOS.includes(mutacion.objetivo)) defectosDeLaMutacion.push("objetivo inválido");
        const esperado = mutacion.esperado;
        if (!esObjeto(esperado)) {
          defectosDeLaMutacion.push("falta «esperado»");
        } else if (esperado.pasa === true) {
          if (esperado.codigo !== undefined)
            defectosDeLaMutacion.push("«pasa» y «codigo» a la vez");
        } else if (!esTextoNoVacio(esperado.codigo)) {
          defectosDeLaMutacion.push("«esperado.codigo» falta");
        } else if (
          mutacion.pendiente === undefined &&
          !invariante.codigosDeFalla.includes(esperado.codigo)
        ) {
          defectosDeLaMutacion.push(
            `«esperado.codigo» («${esperado.codigo}») no está en los códigos del invariante`,
          );
        }
        if (mutacion.pendiente !== undefined && !esTextoNoVacio(mutacion.pendiente)) {
          defectosDeLaMutacion.push("«pendiente» sin motivo");
        }
      } else {
        if (mutacion.esperado !== undefined || mutacion.pendiente !== undefined) {
          defectosDeLaMutacion.push("«noAplica» junto con «esperado» o «pendiente»");
        }
        if (
          !esTextoNoVacio(mutacion.noAplica) ||
          mutacion.noAplica.trim().length < LARGO_MINIMO_DEL_MOTIVO
        ) {
          nuevo(
            "matriz-noaplica-sin-motivo",
            donde,
            `${invariante.id}: la mutación «${String(mutacion.id)}» (${String(mutacion.tipo)}) dice «noAplica» sin un motivo escrito.`,
            "Escribí por qué ese tipo de mutación no tiene sentido para el invariante, o definí la mutación.",
          );
        }
      }
      if (defectosDeLaMutacion.length > 0) {
        nuevo(
          "matriz-mutacion-mal-formada",
          donde,
          `${invariante.id}: la mutación «${String(mutacion.id)}» está mal formada: ${defectosDeLaMutacion.join("; ")}.`,
          "Completá la mutación con id, tipo, objetivo, descripción y esperado.",
        );
      }
    }
    // M2: mutaciones de cada tipo, o un noAplica escrito para ese tipo.
    for (const tipo of TIPOS_DE_MUTACION) {
      if (!invariante.mutaciones.some((m) => m.tipo === tipo)) {
        nuevo(
          "matriz-invariante-sin-tipos",
          donde,
          `${invariante.id} no tiene mutaciones de tipo ${tipo} ni un noAplica escrito para ese tipo.`,
          `Agregá una mutación de tipo ${tipo} o un noAplica con motivo.`,
        );
      }
    }
  }
  // M5: ids únicos y un aplicador por mutación.
  for (const { invariante, mutacion } of todas) {
    if (esTextoNoVacio(mutacion.id)) {
      if (idsVistos.has(mutacion.id)) {
        nuevo(
          "matriz-id-repetido",
          `id: "${mutacion.id}"`,
          `${invariante.id}: el id de mutación «${mutacion.id}» está repetido.`,
          "Cada mutación lleva un id propio: es la clave de su aplicador.",
        );
      }
      idsVistos.add(mutacion.id);
      if (mutacion.noAplica === undefined && !conAplicador.has(mutacion.id)) {
        nuevo(
          "matriz-mutacion-sin-aplicador",
          `id: "${mutacion.id}"`,
          `${invariante.id}: la mutación «${mutacion.id}» está declarada y no tiene aplicador en las pruebas.`,
          "Escribí su aplicador en guardian-matriz-apoyo.ts: una mutación sin aplicador no prueba nada.",
        );
      }
    }
  }
  for (const id of conAplicador) {
    if (!todas.some(({ mutacion }) => mutacion.id === id && mutacion.noAplica === undefined)) {
      nuevo(
        "matriz-aplicador-huerfano",
        "const INVARIANTES",
        `Hay un aplicador para «${id}» y el catálogo no declara esa mutación.`,
        "Declaralo en el catálogo o borrá el aplicador.",
      );
    }
  }
  // M1: cada código de falla (del guardián y de los verificadores del mecanismo), en ≥ 1 invariante y
  // con ≥ 1 mutación que lo espere.
  for (const codigo of conocidos) {
    if (!invariantes.some((i) => (i.codigosDeFalla ?? []).includes(codigo))) {
      nuevo(
        "matriz-codigo-sin-invariante",
        "const INVARIANTES",
        `El código de falla «${codigo}» no pertenece a ningún invariante.`,
        "Asignalo a un invariante (y agregá la mutación que lo prueba): un chequeo sin invariante no se protege.",
      );
    } else if (
      !todas.some(
        ({ mutacion }) => mutacion.noAplica === undefined && mutacion.esperado?.codigo === codigo,
      )
    ) {
      nuevo(
        "matriz-codigo-sin-mutacion",
        "const INVARIANTES",
        `Ninguna mutación espera el código de falla «${codigo}»: nada prueba que el guardián lo emita.`,
        "Agregá la mutación que lo provoca al invariante que lo protege.",
      );
    }
  }
  return problemas;
}

module.exports = {
  INVARIANTES,
  TIPOS_DE_MUTACION,
  OBJETIVOS,
  IDS_DE_INVARIANTES,
  ARCHIVO_DE_LA_MATRIZ,
  comprobarMatriz,
  huecosAbiertos,
  ejecutables,
};
