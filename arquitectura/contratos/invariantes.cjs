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
 *                    repo roto conocido), `matriz` (una copia de este mismo catálogo), `evasion` (un caso de
 *                    la batería de evasión con un resultado observado simulado: lo que dice
 *                    `evasiones.cjs#evaluarResultado`) o `base-y-pr` (DOS árboles temporales —copias del
 *                    repositorio real, la base sana y el pull request alterado— que compara
 *                    `no-debilitar.cjs`, la vigilancia de la versión anterior) o `deuda` (uno o dos
 *                    árboles en memoria —el cambio y, si hace falta, la base— que evalúa el control de
 *                    deuda técnica, `arquitectura/deuda/deuda.cjs`);
 *  - `descripcion`   qué se le hace al sistema;
 *  - `esperado`      qué tiene que pasar: `{ codigo, archivo?, linea? | lineaDe?, contrato?,
 *                    contieneMotivo? }` (la verificación FALLA con ese código y, si se fija, en ese
 *                    archivo y línea exactos), o `{ pasa: true }` para lo que NO debe fallar;
 *  - `noAplica`      en vez de `esperado`: por qué ese tipo de mutación no tiene sentido para el
 *                    invariante (el motivo es obligatorio: M2);
 *  - `pendiente`     HUECO ABIERTO: la mutación hoy SOBREVIVE (el guardián no falla) y el motivo dice
 *                    qué falta. La prueba exige que siga sobreviviendo; si alguien cierra el hueco y no
 *                    saca la marca, falla (así un hueco nunca queda anotado de más ni olvidado). Hoy no
 *                    hay ninguno (regla del dueño: una mutación que sobrevive se corrige, no se deja
 *                    pendiente); el mecanismo sigue para marcar uno futuro mientras se lo cierra.
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
const { CODIGOS_DE_FALLA: CODIGOS_DE_VIGILANCIA } = require("./no-debilitar.cjs");
const { CODIGOS_DE_FALLA: CODIGOS_DE_DEUDA } = require("../deuda/codigos.cjs");

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
  "evasion",
  "base-y-pr",
  "deuda",
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
  "I11",
  "I12",
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
const VIGILANCIA = "arquitectura/contratos/no-debilitar.cjs";
const EVASIONES = "arquitectura/contratos/evasiones.cjs";
const CATALOGO_DE_EVASION = "arquitectura/contratos/evasiones.json";
const CI = ".github/workflows/ci.yml";
const PRUEBAS = "test/arquitectura/guardian-*.test.ts";
const DEUDA = "arquitectura/deuda/deuda.cjs";
const LIBRO_DE_DEUDA = "arquitectura/deuda/libro.cjs";
const ANTES_Y_DESPUES = "arquitectura/deuda/antes-y-despues.cjs";
const MARCADORES = "arquitectura/deuda/marcadores.cjs";
const TAMANO_DE_ARCHIVOS = "arquitectura/deuda/tamano.cjs";
const ENTRADAS_DE_DEUDA = "arquitectura/deuda/entradas.cjs";
const REGISTRO_DE_DEUDA = "arquitectura/deuda/registro.json";
const CONFIGURACION_DE_DEUDA = "arquitectura/deuda/configuracion.json";
const PAQUETE = "package.json";

/** @type {readonly object[]} */
const INVARIANTES = [
  {
    id: "I1",
    enunciado: "Toda ruta versionada tiene exactamente una clase.",
    elementos: {
      aplica: [`${CLASIFICACION}#clasificar`, `${GUARDIAN}#ejecutar (clase-sin-rutas)`],
      define: [`${CLASIFICACION}#NIVELES`, `${CLASIFICACION}#CLASES`],
      parametriza: [
        `${CLASIFICACION}#CLASES_ESPERADAS`,
        `${CLASIFICACION}#CLASES_EXCLUIBLES`,
        `${CLASIFICACION}#PERMITIDO_EN_CLASE_EXCLUIDA`,
        `${CLASIFICACION}#EXTENSIONES_DE_CODIGO`,
      ],
      hacePosible: [
        "`git ls-files` (cargarDelRepo)",
        `${VIGILANCIA}#chequearClases (las clases esperadas no se reducen)`,
        "npm run guardian",
        `${PRUEBAS}`,
      ],
    },
    codigosDeFalla: [
      "regla-de-clasificacion-invalida",
      "ruta-sin-clase",
      "clasificacion-ambigua",
      "clase-sin-rutas",
      "codigo-en-clase-excluida",
      "clases-esperadas-reducidas",
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
          "La tabla de clasificación manda `src/capacidades/**` a la clase `docs` (excluida) mientras ahí se usa un contrato sin declararlo: el código saldría del análisis.",
        esperado: {
          codigo: "codigo-en-clase-excluida",
          archivo: "src/capacidades/permisos/separador.ts",
          linea: 1,
        },
      },
      {
        id: "I1-reclasificar-un-script-como-generado",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "La regla de `scripts/**` pasa a la clase `generado` (excluida).",
        esperado: { codigo: "codigo-en-clase-excluida", archivo: "scripts/migrar.ts", linea: 1 },
      },
      {
        id: "I1-codigo-escondido-en-la-carpeta-de-documentos",
        tipo: "elusion",
        objetivo: "repo",
        descripcion:
          "Un script `.sh` se agrega bajo `.claude/`, que la tabla clasifica como `docs` (excluida).",
        esperado: {
          codigo: "codigo-en-clase-excluida",
          archivo: ".claude/hooks/ejecutar.sh",
          linea: 1,
        },
      },
      {
        id: "I1-archivo-binario-en-una-clase-excluida",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion:
          "Un archivo que no es documento (una imagen) se agrega bajo `.claude/`: tampoco es de un tipo permitido en una clase excluida.",
        esperado: { codigo: "codigo-en-clase-excluida", archivo: ".claude/imagen.png", linea: 1 },
      },
      {
        id: "I1-dejar-de-esperar-una-clase",
        tipo: "exclusion",
        objetivo: "base-y-pr",
        descripcion:
          "El pull request saca `scripts` de `CLASES_ESPERADAS`: si la clase quedara vacía, el guardián diría «pasó» sin haber mirado nada de ella.",
        esperado: {
          codigo: "clases-esperadas-reducidas",
          archivo: CLASIFICACION,
          lineaDe: "const CLASES_ESPERADAS",
        },
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
      aplica: [
        `${COMPARACION}#comparar (definicion-fuera-de-la-fuente, contrato-sin-fuente)`,
        `${REGISTRO}#validarDefinicion (todo contrato tiene un detector de definicion)`,
      ],
      define: ["contrato.fuenteDeVerdad en contratos.cjs", "el archivo que la contiene"],
      parametriza: [
        "detectores de tipo `definicion` de cada contrato",
        "detector.clases",
        "contrato.sinDetectorDeDefinicion (la ausencia declarada, con motivo)",
      ],
      hacePosible: [
        `${REGISTRO}#cargarRegistro`,
        `${VIGILANCIA}#chequearContratos (sin-definicion-nueva)`,
        "npm run guardian",
        `${PRUEBAS}`,
      ],
    },
    codigosDeFalla: ["definicion-fuera-de-la-fuente", "contrato-sin-fuente", "registro-invalido"],
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
          "Se saca del contrato el detector de `definicion` y se copia el valor en otro archivo: el registro ya no se acepta, así que la copia no pasa en silencio.",
        esperado: {
          codigo: "registro-invalido",
          archivo: "arquitectura/contratos/contratos.cjs",
          linea: 4,
          contieneMotivo: "«definicion»",
        },
      },
      {
        id: "I4-motivo-de-ausencia-de-definicion-vacio",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion:
          "El contrato sin detector de definición declara `sinDetectorDeDefinicion` con una palabra suelta en vez de un motivo.",
        esperado: {
          codigo: "registro-invalido",
          archivo: "arquitectura/contratos/contratos.cjs",
          linea: 4,
          contieneMotivo: "sinDetectorDeDefinicion",
        },
      },
      {
        id: "I4-ausencia-declarada-con-un-detector-de-definicion",
        tipo: "duplicacion",
        objetivo: "repo",
        descripcion:
          "El contrato declara `sinDetectorDeDefinicion` y conserva su detector de `definicion`: la declaración es contradictoria.",
        esperado: {
          codigo: "registro-invalido",
          archivo: "arquitectura/contratos/contratos.cjs",
          linea: 4,
          contieneMotivo: "contradictorios",
        },
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
        id: "I4-definicion-escondida-en-un-archivo-con-extension-de-binario",
        tipo: "elusion",
        objetivo: "repo",
        descripcion:
          "La copia del valor se escribe como texto dentro de un archivo `.png`: el detector tiene que leerlo igual, porque no es un binario de verdad.",
        esperado: {
          codigo: "definicion-fuera-de-la-fuente",
          archivo: "apps/web/ui/paleta.png",
          linea: 1,
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
      hacePosible: [
        "el reloj inyectable (`ahora`)",
        `${VIGILANCIA}#chequearRigor (el tope no sube y el aviso no baja)`,
        "npm run guardian",
        `${PRUEBAS}`,
      ],
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
      "tope-de-excepciones-subio",
      "aviso-de-excepciones-bajo",
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
        id: "I5-subir-el-tope-de-dias-de-las-excepciones",
        tipo: "alteracion",
        objetivo: "base-y-pr",
        descripcion:
          "El pull request sube `PLAZO_MAXIMO_DIAS` de 60 a 90: las excepciones durarían más de lo que decidió el dueño.",
        esperado: {
          codigo: "tope-de-excepciones-subio",
          archivo: "arquitectura/contratos/excepciones.cjs",
          lineaDe: "const PLAZO_MAXIMO_DIAS",
        },
      },
      {
        id: "I5-bajar-el-aviso-previo-al-vencimiento",
        tipo: "alteracion",
        objetivo: "base-y-pr",
        descripcion:
          "El pull request baja `DIAS_DE_AVISO` de 14 a 1: el aviso de vencimiento llegaría tarde.",
        esperado: {
          codigo: "aviso-de-excepciones-bajo",
          archivo: "arquitectura/contratos/excepciones.cjs",
          lineaDe: "const DIAS_DE_AVISO",
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
        `${CLASIFICACION}#revisarClasesExcluidas (lo que una clase excluida puede contener)`,
        `${VIGILANCIA}#chequearClases (las clases excluibles y lo permitido en ellas no se amplían)`,
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
      "codigo-en-clase-excluida",
      "clases-excluibles-ampliadas",
      "extensiones-permitidas-ampliadas",
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
        id: "I6-ampliar-las-clases-que-se-pueden-excluir",
        tipo: "exclusion",
        objetivo: "base-y-pr",
        descripcion:
          "El pull request agrega `backend` a `CLASES_EXCLUIBLES`: una exclusión podría sacar el código del servidor del análisis.",
        esperado: {
          codigo: "clases-excluibles-ampliadas",
          archivo: CLASIFICACION,
          lineaDe: "const CLASES_EXCLUIBLES",
          contieneMotivo: "backend",
        },
      },
      {
        id: "I6-ampliar-lo-permitido-en-una-clase-excluida",
        tipo: "exclusion",
        objetivo: "base-y-pr",
        descripcion:
          "El pull request agrega la extensión `.ts` a lo permitido en la clase `docs` para poder esconder código ahí.",
        esperado: {
          codigo: "extensiones-permitidas-ampliadas",
          archivo: CLASIFICACION,
          lineaDe: "const PERMITIDO_EN_CLASE_EXCLUIDA",
          contieneMotivo: "docs → extension:.ts",
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
        `${VIGILANCIA}#chequearLectura (lo que no se pudo leer es una falla, no un «pasa»)`,
      ],
      define: ["arquitectura/contratos/informe.json (evidencia de cada corrida)"],
      parametriza: [`${CLASIFICACION}#CLASES_ESPERADAS`, "detector.clases"],
      hacePosible: [
        "`git ls-files -z` (cargarDelRepo: un nombre que no es UTF-8, un enlace roto o una ruta ausente que no es un borrado pendiente fallan)",
        "npm run guardian",
        `${PRUEBAS}`,
        "la batería de evasión (EV-084, EV-100, EV-101: lo que no se pudo leer nunca pasa en silencio)",
      ],
    },
    codigosDeFalla: [
      "sin-rutas",
      "clase-sin-rutas",
      "detector-sin-rutas",
      "ruta-ilegible",
      "informe-sin-evidencia",
      "arbol-ilegible",
      "base-ilegible",
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
        id: "I7-archivo-que-no-es-texto-utf8",
        tipo: "elusion",
        objetivo: "repo",
        descripcion:
          "Una hoja de estilos se guarda en UTF-16 (con bytes nulos): ningún detector la puede leer y no se omite por su extensión.",
        esperado: { codigo: "ruta-ilegible", archivo: "apps/web/ui/Linea.module.css", linea: 1 },
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
        id: "I7-el-registro-del-pr-no-se-puede-leer",
        tipo: "alteracion",
        objetivo: "base-y-pr",
        descripcion:
          "El `contratos.cjs` del pull request lanza un error al cargarse: la vigilancia no puede comparar y no lo da por bueno.",
        esperado: {
          codigo: "arbol-ilegible",
          archivo: "arquitectura/contratos/contratos.cjs",
          linea: 1,
        },
      },
      {
        id: "I7-el-registro-de-la-base-no-se-puede-leer",
        tipo: "desconexion",
        objetivo: "base-y-pr",
        descripcion:
          "El `contratos.cjs` de la base lanza un error al cargarse: no hay con qué comparar y no se da por bueno.",
        esperado: {
          codigo: "base-ilegible",
          archivo: "arquitectura/contratos/contratos.cjs",
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
        `comparación con la base (\`--base\` del guardián y ${VIGILANCIA}#chequearRetiros, #chequearContratos)`,
        "arquitectura/contratos/retiros.json (el retiro de un contrato es una decisión registrada)",
        "npm run guardian",
        `${PRUEBAS}`,
      ],
    },
    codigosDeFalla: [
      "registro-invalido",
      "declara-contrato-inexistente",
      "retiro-sin-registro",
      "retiro-invalido",
      "retiro-borrado",
      "detectores-perdidos",
      "clases-de-detector-perdidas",
      "fuente-cambiada-sin-version",
      "sin-definicion-nueva",
    ],
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
        objetivo: "base-y-pr",
        descripcion:
          "Dos árboles: la base trae un contrato real con sus declaraciones; el pull request borra el contrato del registro y su id de todas las declaraciones, y el árbol queda coherente (un solo árbol no lo ve: lo detecta la vigilancia de la versión anterior).",
        esperado: {
          codigo: "retiro-sin-registro",
          archivo: "arquitectura/contratos/contratos.cjs",
          lineaDe: "module.exports",
          contrato: "color-de-separadores",
        },
      },
      {
        id: "I8-retiro-registrado-sin-aprobacion",
        tipo: "alteracion",
        objetivo: "base-y-pr",
        descripcion:
          "El contrato se borra con una entrada en `retiros.json` a la que le falta `aprobadoPor`: el retiro no es una decisión registrada completa.",
        esperado: {
          codigo: "retiro-invalido",
          archivo: "arquitectura/contratos/retiros.json",
          linea: 2,
        },
      },
      {
        id: "I8-borrar-un-retiro-registrado",
        tipo: "eliminacion",
        objetivo: "base-y-pr",
        descripcion:
          "El pull request borra de `retiros.json` un retiro que la base ya registraba: el registro de retiros es histórico.",
        esperado: {
          codigo: "retiro-borrado",
          archivo: "arquitectura/contratos/retiros.json",
          linea: 1,
          contrato: "contrato-viejo",
        },
      },
      {
        id: "I8-perder-un-detector-de-uso",
        tipo: "eliminacion",
        objetivo: "base-y-pr",
        descripcion:
          "El pull request quita uno de los dos detectores de uso del contrato: reconocería menos usos que antes.",
        esperado: {
          codigo: "detectores-perdidos",
          archivo: "arquitectura/contratos/contratos.cjs",
          lineaDe: 'id: "color-de-separadores"',
          contrato: "color-de-separadores",
        },
      },
      {
        id: "I8-detector-que-deja-de-mirar-una-clase",
        tipo: "desconexion",
        objetivo: "base-y-pr",
        descripcion:
          "Un detector de uso del contrato deja de mirar la clase `backend`: un uso ahí ya no se vería.",
        esperado: {
          codigo: "clases-de-detector-perdidas",
          archivo: "arquitectura/contratos/contratos.cjs",
          lineaDe: 'id: "color-de-separadores"',
          contrato: "color-de-separadores",
          contieneMotivo: "backend",
        },
      },
      {
        id: "I8-cambiar-la-fuente-de-verdad-sin-subir-la-version",
        tipo: "alteracion",
        objetivo: "base-y-pr",
        descripcion:
          "El pull request apunta el contrato a otra variable sin subir su `version`: un cambio de fuente es un cambio de contrato.",
        esperado: {
          codigo: "fuente-cambiada-sin-version",
          archivo: "arquitectura/contratos/contratos.cjs",
          lineaDe: 'id: "color-de-separadores"',
          contrato: "color-de-separadores",
        },
      },
      {
        id: "I8-declarar-que-no-hay-detector-de-definicion",
        tipo: "elusion",
        objetivo: "base-y-pr",
        descripcion:
          "El pull request quita el detector de definición del contrato y declara `sinDetectorDeDefinicion` con un motivo: el registro lo acepta, la vigilancia de la versión anterior lo trata como debilitamiento.",
        esperado: {
          codigo: "sin-definicion-nueva",
          archivo: "arquitectura/contratos/contratos.cjs",
          lineaDe: 'id: "color-de-separadores"',
          contrato: "color-de-separadores",
        },
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
        "test/arquitectura/gate-coincide-con-ci.test.ts",
        `${MECANISMO}#evaluarCanario`,
        `${VIGILANCIA}#chequearCi, #chequearGate y #chequearPaquete (contra la base)`,
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
      "ci-sin-job-guardian",
      "ci-gate-no-espera-guardian",
      "gate-no-exige-guardian",
      "ci-guardian-sin-ejecutar",
      "ci-guardian-con-salto",
      "script-arquitectura-desviado",
      "script-guardian-desviado",
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
      // El trabajo `guardian` del ci.yml real (con sus pasos condicionales de la rama base): el verificador
      // de la matriz tiene que ser compatible con él y fallar donde corresponde.
      {
        id: "I9-el-guardian-sale-de-los-needs-del-gate",
        tipo: "eliminacion",
        objetivo: "workflow",
        descripcion: "El trabajo `guardian` sale de `needs` del Gate: podría fallar sin bloquear.",
        esperado: {
          codigo: "ci-job-fuera-del-gate",
          archivo: CI,
          lineaDe: { texto: "needs:", despuesDe: "  gate:" },
        },
      },
      {
        id: "I9-el-guardian-pierde-su-tope-de-tiempo",
        tipo: "eliminacion",
        objetivo: "workflow",
        descripcion: "El trabajo `guardian` pierde su `timeout-minutes`.",
        esperado: { codigo: "ci-job-sin-tope", archivo: CI, lineaDe: "  guardian:" },
      },
      {
        id: "I9-condicion-en-el-paso-que-corre-el-guardian",
        tipo: "exclusion",
        objetivo: "workflow",
        descripcion:
          "El paso que corre `guardian.cjs` en el trabajo `guardian` suma `if: github.event_name == 'push'`: en un pull request se saltearía y el trabajo quedaría en verde.",
        esperado: {
          codigo: "ci-job-condicionado",
          archivo: CI,
          lineaDe: "if: github.event_name == 'push'",
        },
      },
      {
        id: "I9-el-guardian-corre-con-tolerancia-al-error",
        tipo: "alteracion",
        objetivo: "workflow",
        descripcion: "El paso que corre `guardian.cjs` termina en `|| true`: nunca falla.",
        esperado: {
          codigo: "ci-comando-tolerante",
          archivo: CI,
          lineaDe: "guardian.cjs || true",
        },
      },
      // La versión anterior (la base) vigila a la nueva: no se debilita lo que la base exigía.
      {
        id: "I9-el-pull-request-borra-el-trabajo-guardian",
        tipo: "eliminacion",
        objetivo: "base-y-pr",
        descripcion: "El pull request borra el trabajo `guardian` de `ci.yml`.",
        esperado: { codigo: "ci-sin-job-guardian", archivo: CI, lineaDe: "jobs:" },
      },
      {
        id: "I9-el-gate-deja-de-esperar-al-guardian",
        tipo: "eliminacion",
        objetivo: "base-y-pr",
        descripcion: "El pull request saca `guardian` de `needs` del Gate.",
        esperado: {
          codigo: "ci-gate-no-espera-guardian",
          archivo: CI,
          lineaDe: { texto: "needs:", despuesDe: "  gate:" },
        },
      },
      {
        id: "I9-evaluar-gate-deja-pasar-un-guardian-caido",
        tipo: "alteracion",
        objetivo: "base-y-pr",
        descripcion: "El pull request saca `guardian` de `OBLIGATORIOS` en `evaluar-gate.cjs`.",
        esperado: {
          codigo: "gate-no-exige-guardian",
          archivo: "arquitectura/evaluar-gate.cjs",
          lineaDe: "const OBLIGATORIOS",
        },
      },
      {
        id: "I9-el-trabajo-guardian-deja-de-ejecutar-el-guardian",
        tipo: "desconexion",
        objetivo: "base-y-pr",
        descripcion: "El paso del trabajo `guardian` queda como `guardian.cjs || true`.",
        esperado: { codigo: "ci-guardian-sin-ejecutar", archivo: CI, lineaDe: "  guardian:" },
      },
      {
        id: "I9-continue-on-error-en-el-trabajo-guardian",
        tipo: "alteracion",
        objetivo: "base-y-pr",
        descripcion:
          "El pull request agrega `continue-on-error: true` al trabajo `guardian`, que la base no tenía.",
        esperado: {
          codigo: "ci-guardian-con-salto",
          archivo: CI,
          lineaDe: "continue-on-error: true",
        },
      },
      {
        id: "I9-condicion-nueva-en-el-paso-del-guardian-respecto-de-la-base",
        tipo: "exclusion",
        objetivo: "base-y-pr",
        descripcion:
          "El pull request suma un `if` al paso que corre `guardian.cjs`, que la base no tenía.",
        esperado: {
          codigo: "ci-guardian-con-salto",
          archivo: CI,
          lineaDe: "if: github.event_name == 'push'",
        },
      },
      {
        id: "I9-el-script-arquitectura-deja-de-encadenar-el-guardian-respecto-de-la-base",
        tipo: "duplicacion",
        objetivo: "base-y-pr",
        descripcion:
          "El pull request quita `&& npm run guardian` del script `arquitectura` del package.json real.",
        esperado: {
          codigo: "script-arquitectura-desviado",
          archivo: "package.json",
          lineaDe: '"arquitectura":',
        },
      },
      {
        id: "I9-el-script-guardian-se-desvia-respecto-de-la-base",
        tipo: "elusion",
        objetivo: "base-y-pr",
        descripcion: "El pull request deja el script `guardian` como `guardian.cjs || true`.",
        esperado: {
          codigo: "script-guardian-desviado",
          archivo: "package.json",
          lineaDe: '"guardian":',
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
        `${VIGILANCIA}#chequearCodigos y #chequearInvariantes (la base vigila que la matriz solo crezca)`,
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
      "chequeo-borrado",
      "invariante-borrada",
      "mutacion-borrada",
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
      // La versión anterior vigila que la matriz y los chequeos solo crezcan (probado con el
      // `invariantes.cjs` y el `codigos.cjs` REALES como base).
      {
        id: "I10-borrar-un-chequeo-del-guardian",
        tipo: "eliminacion",
        objetivo: "base-y-pr",
        descripcion: "El pull request borra un código de falla de `codigos.cjs` (un chequeo).",
        esperado: {
          codigo: "chequeo-borrado",
          archivo: "arquitectura/contratos/codigos.cjs",
          lineaDe: "const CODIGOS_DE_FALLA",
          contieneMotivo: "sin-rutas",
        },
      },
      {
        id: "I10-quitar-una-mutacion-del-catalogo-real",
        tipo: "eliminacion",
        objetivo: "base-y-pr",
        descripcion:
          "El pull request borra la mutación `I1-quitar-la-regla-de-una-carpeta` del `invariantes.cjs` real.",
        esperado: {
          codigo: "mutacion-borrada",
          archivo: ARCHIVO_DE_LA_MATRIZ,
          lineaDe: 'id: "I1",',
          contieneMotivo: "I1-quitar-la-regla-de-una-carpeta",
        },
      },
      {
        id: "I10-quitar-un-invariante-del-catalogo-real",
        tipo: "exclusion",
        objetivo: "base-y-pr",
        descripcion: "El pull request borra el invariante I7 entero del `invariantes.cjs` real.",
        esperado: {
          codigo: "invariante-borrada",
          archivo: ARCHIVO_DE_LA_MATRIZ,
          lineaDe: "const INVARIANTES",
          contieneMotivo: "I7",
        },
      },
    ],
  },
  {
    id: "I11",
    enunciado:
      "La batería de evasión (§11) conserva todos sus casos y lo que esperan, no se afloja en silencio, no deja brechas ni riesgos vencidos y corre en el Gate.",
    elementos: {
      aplica: [
        `${EVASIONES}#validarCatalogo`,
        `${EVASIONES}#evaluarResultado`,
        `${GUARDIAN}#ejecutar (paso 6: el catálogo de la batería de evasión)`,
        `${VIGILANCIA}#chequearEvasiones y #avisarRiesgosNuevos`,
        "test/arquitectura/guardian-evasion.test.ts (el corredor: un repositorio sintético por caso)",
      ],
      define: [CATALOGO_DE_EVASION, "arquitectura/contratos/evasiones-github.json"],
      parametriza: [
        `${EVASIONES}#PLAZO_DE_BRECHA`,
        `${EVASIONES}#PLAZO_DE_RIESGO`,
        `${EVASIONES}#DIAS_DE_AVISO_DE_BRECHA`,
        `${EVASIONES}#DIAS_DE_AVISO_DE_RIESGO`,
        `${EVASIONES}#VIAS`,
        "arquitectura/contratos/retiros.json (retirar un caso exige una entrada con su id)",
      ],
      hacePosible: [
        "npm run guardian (reporta las brechas en cada corrida y falla si vencen)",
        "test/arquitectura/guardian-evasion.test.ts (job pruebas, requerido por el Gate)",
        `${MECANISMO}#PRUEBAS_DEL_GUARDIAN y #escanearPruebasDelGuardian`,
        `${MECANISMO}#verificarVitestConfig`,
        `${VIGILANCIA}#chequearEvasiones (la base vigila que el catálogo solo se endurezca)`,
      ],
    },
    codigosDeFalla: [
      "evasion-invalida",
      "brecha-plazo-excesivo",
      "brecha-vencida",
      "riesgo-plazo-excesivo",
      "riesgo-vencido",
      "evasion-no-bloqueada",
      "brecha-cerrada",
      "riesgo-cerrado",
      "evasion-borrada",
      "evasion-esperado-cambiado",
      "evasion-degradada",
      "evasion-via-perdida",
      "vitest-excluye-pruebas",
      "prueba-saltada",
      "pruebas-del-guardian-borradas",
    ],
    mutaciones: [
      {
        id: "I11-borrar-un-caso-del-catalogo",
        tipo: "eliminacion",
        objetivo: "base-y-pr",
        descripcion:
          "El pull request borra del catálogo real el caso EV-001 (un control positivo) sin registrar su retiro.",
        esperado: {
          codigo: "evasion-borrada",
          archivo: CATALOGO_DE_EVASION,
          linea: 1,
          contieneMotivo: "EV-001",
        },
      },
      {
        id: "I11-retirar-un-caso-con-su-entrada-en-retiros",
        tipo: "alteracion",
        objetivo: "base-y-pr",
        descripcion:
          "El pull request borra el caso EV-001 y registra su retiro en `retiros.json` con el id del caso: es una decisión escrita y no falla.",
        esperado: { pasa: true },
      },
      {
        id: "I11-borrar-el-catalogo-entero",
        tipo: "eliminacion",
        objetivo: "base-y-pr",
        descripcion:
          "El pull request borra `evasiones.json` entero: cada caso de la base queda sin retiro.",
        esperado: { codigo: "evasion-borrada", archivo: CATALOGO_DE_EVASION, linea: 1 },
      },
      {
        id: "I11-vaciar-una-via",
        tipo: "eliminacion",
        objetivo: "base-y-pr",
        descripcion:
          "El pull request retira (con su entrada en `retiros.json`) el único caso de la vía `renombrar-mover`: esa ruta de evasión deja de probarse.",
        esperado: {
          codigo: "evasion-via-perdida",
          archivo: CATALOGO_DE_EVASION,
          linea: 1,
          contieneMotivo: "renombrar-mover",
        },
      },
      {
        id: "I11-cambiar-lo-que-un-caso-espera",
        tipo: "alteracion",
        objetivo: "base-y-pr",
        descripcion:
          "El pull request cambia el código que el caso EV-001 espera: lo que se considera un resultado aceptable cambió.",
        esperado: {
          codigo: "evasion-esperado-cambiado",
          archivo: CATALOGO_DE_EVASION,
          lineaDe: { texto: '"esperado"', despuesDe: '"id": "EV-001"' },
          contieneMotivo: "EV-001",
        },
      },
      {
        id: "I11-aflojar-un-caso-exigido",
        tipo: "alteracion",
        objetivo: "base-y-pr",
        descripcion:
          "El pull request pasa el caso exigido EV-001 a riesgo aceptado (con todos sus campos): un control positivo se afloja en silencio.",
        esperado: {
          codigo: "evasion-degradada",
          archivo: CATALOGO_DE_EVASION,
          lineaDe: { texto: '"estado"', despuesDe: '"id": "EV-001"' },
          contieneMotivo: "EV-001",
        },
      },
      {
        id: "I11-extender-una-brecha",
        tipo: "alteracion",
        objetivo: "base-y-pr",
        descripcion:
          "El pull request mueve más tarde el `vence` de la brecha abierta de la base (los mismos 60 días, desde un `creada` nuevo): extender una brecha es debilitarla.",
        esperado: {
          codigo: "evasion-degradada",
          archivo: CATALOGO_DE_EVASION,
          lineaDe: { texto: '"vence"', despuesDe: '"id": "EV-950"' },
        },
      },
      {
        id: "I11-mover-un-caso-a-los-externos",
        tipo: "exclusion",
        objetivo: "base-y-pr",
        descripcion:
          "El pull request saca el caso EV-001 de `evasiones.json` y lo anota en `evasiones-github.json` como externo: dejaría de correr y de bloquear.",
        esperado: {
          codigo: "evasion-degradada",
          archivo: "arquitectura/contratos/evasiones-github.json",
          contieneMotivo: "EV-001",
        },
      },
      {
        id: "I11-id-repetido-en-el-catalogo",
        tipo: "duplicacion",
        objetivo: "repo",
        descripcion: "Dos casos del catálogo comparten el mismo id.",
        esperado: {
          codigo: "evasion-invalida",
          archivo: CATALOGO_DE_EVASION,
          lineaDe: { texto: '"id"', despuesDe: '"id": "EV-001"' },
          contieneMotivo: "repetido",
        },
      },
      {
        id: "I11-caso-exigido-con-campos-de-brecha",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "Un caso exigido trae el campo `vence` de las brechas: no se mezclan estados.",
        esperado: {
          codigo: "evasion-invalida",
          archivo: CATALOGO_DE_EVASION,
          lineaDe: '"vence"',
          contieneMotivo: "vence",
        },
      },
      {
        id: "I11-brecha-con-mas-de-60-dias",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "Una brecha abierta vence a 90 días de su creación.",
        esperado: {
          codigo: "brecha-plazo-excesivo",
          archivo: CATALOGO_DE_EVASION,
          lineaDe: '"vence"',
        },
      },
      {
        id: "I11-brecha-vencida",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "Una brecha abierta venció respecto del reloj.",
        esperado: { codigo: "brecha-vencida", archivo: CATALOGO_DE_EVASION, lineaDe: '"vence"' },
      },
      {
        id: "I11-riesgo-con-revision-a-mas-de-180-dias",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "Un riesgo aceptado se revisa a 200 días de su creación.",
        esperado: {
          codigo: "riesgo-plazo-excesivo",
          archivo: CATALOGO_DE_EVASION,
          lineaDe: '"revisar"',
        },
      },
      {
        id: "I11-riesgo-con-revision-vencida",
        tipo: "alteracion",
        objetivo: "repo",
        descripcion: "La fecha de revisión de un riesgo aceptado ya pasó.",
        esperado: { codigo: "riesgo-vencido", archivo: CATALOGO_DE_EVASION, lineaDe: '"revisar"' },
      },
      {
        id: "I11-caso-exigido-que-pasa-sin-deteccion",
        tipo: "elusion",
        objetivo: "evasion",
        descripcion:
          "Un caso exigido corre y el cambio PASA: el control que lo bloqueaba dejó de hacerlo.",
        esperado: {
          codigo: "evasion-no-bloqueada",
          archivo: CATALOGO_DE_EVASION,
          lineaDe: '"estado"',
        },
      },
      {
        id: "I11-brecha-cerrada-sin-pasarla-a-exigido",
        tipo: "elusion",
        objetivo: "evasion",
        descripcion:
          "Una brecha abierta corre y el cambio ahora se bloquea: hay que pasarla a exigido, no dejarla como brecha.",
        esperado: { codigo: "brecha-cerrada", archivo: CATALOGO_DE_EVASION, lineaDe: '"estado"' },
      },
      {
        id: "I11-riesgo-que-dejo-de-existir",
        tipo: "elusion",
        objetivo: "evasion",
        descripcion:
          "Un riesgo aceptado corre y el cambio ahora se bloquea: hay que pasarlo a exigido.",
        esperado: { codigo: "riesgo-cerrado", archivo: CATALOGO_DE_EVASION, lineaDe: '"estado"' },
      },
      {
        id: "I11-desconectar-la-prueba-de-evasion",
        tipo: "desconexion",
        objetivo: "pruebas-del-guardian",
        descripcion: "Se borra `guardian-evasion.test.ts`: el corredor de la batería no corre.",
        esperado: {
          codigo: "pruebas-del-guardian-borradas",
          archivo: "test/arquitectura/guardian-evasion.test.ts",
          linea: 1,
        },
      },
      {
        id: "I11-excluir-la-bateria-en-vitest",
        tipo: "exclusion",
        objetivo: "vitest-config",
        descripcion:
          'Se agrega `exclude: ["test/arquitectura/guardian-evasion*"]` al proyecto de Node.',
        esperado: {
          codigo: "vitest-excluye-pruebas",
          archivo: "vitest.config.ts",
          lineaDe: "exclude:",
        },
      },
      {
        id: "I11-saltar-la-bateria",
        tipo: "elusion",
        objetivo: "pruebas-del-guardian",
        descripcion: "Una prueba del corredor de la batería se marca `skip`.",
        esperado: {
          codigo: "prueba-saltada",
          archivo: "test/arquitectura/guardian-evasion.test.ts",
          lineaDe: "marca-de-la-matriz",
        },
      },
    ],
  },
  {
    id: "I12",
    enunciado:
      "La deuda técnica conocida no crece ni se esconde (§10): todo marcador está en el registro, lo que se toca se paga o lleva una excepción vigente, un archivo sobre el tope de líneas no crece, el registro solo se achica si el problema se resolvió, los topes, las exclusiones y la opción de bloqueo no se aflojan y el control corre en el Gate.",
    elementos: {
      aplica: [
        `${LIBRO_DE_DEUDA}#evaluarArbol (marcadores sin registrar, entradas, excepciones y tope)`,
        `${ANTES_Y_DESPUES}#compararConLaBase (a-d: archivo tocado, deuda nueva, total que sube, entrada borrada)`,
        `${MARCADORES}#detectar (qué marcadores hay y en qué línea)`,
        `${TAMANO_DE_ARCHIVOS}#tamanoExcedido (qué archivo pasa del tope de líneas)`,
        `${ENTRADAS_DE_DEUDA}#formaDeLaEntrada y #leerConfiguracion (la forma del registro, el tope de líneas y las exclusiones)`,
        `${DEUDA}#ejecutar y #comprobarUbicaciones (archivo:línea en toda falla)`,
        `${VIGILANCIA}#chequearDeuda, #chequearElPasoDeLaDeuda y #chequearPaquete (la versión anterior vigila el registro, el tope, el bloqueo, el paso de CI y los scripts)`,
      ],
      define: [REGISTRO_DE_DEUDA, `${LIBRO_DE_DEUDA}#TIPOS`, `${MARCADORES}#TIPOS_DE_MARCADOR`],
      parametriza: [
        CONFIGURACION_DE_DEUDA,
        `${EXCEPCIONES}#PLAZO_MAXIMO_DIAS`,
        `${EXCEPCIONES}#DIAS_DE_AVISO`,
        "arquitectura/deuda/codigos.cjs#CODIGOS_DE_FALLA",
      ],
      hacePosible: [
        `${PAQUETE} (scripts deuda y arquitectura)`,
        `${CI} (el paso «Deuda técnica» del job guardian, obligatorio para el Gate)`,
        `${VIGILANCIA}#chequearCi (el paso no se quita ni se saltea)`,
        `${PRUEBAS}`,
        `${MECANISMO}#PRUEBAS_DEL_GUARDIAN`,
      ],
    },
    codigosDeFalla: [
      "deuda-sin-registrar",
      "deuda-entrada-invalida",
      "deuda-archivo-inexistente",
      "deuda-configuracion-invalida",
      "deuda-tope-de-excepciones",
      "deuda-archivo-ilegible",
      "deuda-en-archivo-tocado",
      "deuda-nueva-sin-excepcion",
      "deuda-total-sube",
      "deuda-archivo-crece",
      "deuda-entrada-borrada",
      "excepcion-vencida",
      "excepcion-plazo-excesivo",
      "excepcion-obsoleta",
      "ci-sin-paso-de-deuda",
      "ci-deuda-con-salto",
      "script-arquitectura-sin-deuda",
      "script-deuda-desviado",
      "deuda-tope-subio",
      "deuda-bloqueo-aflojado",
      "deuda-tope-de-lineas-subio",
      "deuda-exclusion-nueva",
      "deuda-entrada-borrada-sin-pagar",
      "pruebas-del-guardian-borradas",
    ],
    mutaciones: [
      {
        id: "I12-pagar-la-deuda-y-borrar-su-entrada",
        tipo: "eliminacion",
        objetivo: "deuda",
        descripcion:
          "El cambio resuelve todos los marcadores de `a.ts` y borra su entrada: pagar deuda nunca bloquea.",
        esperado: { pasa: true },
      },
      {
        id: "I12-borrar-el-paso-de-deuda-del-ci",
        tipo: "eliminacion",
        objetivo: "base-y-pr",
        descripcion: "El pull request quita del job `guardian` el paso «Deuda técnica».",
        esperado: { codigo: "ci-sin-paso-de-deuda", archivo: CI, lineaDe: "  guardian:" },
      },
      {
        id: "I12-borrar-el-registro-de-deuda",
        tipo: "eliminacion",
        objetivo: "deuda",
        descripcion: "Se borra `registro.json`: sin él no hay a qué comparar los marcadores.",
        esperado: { codigo: "deuda-entrada-invalida", archivo: REGISTRO_DE_DEUDA, linea: 1 },
      },
      {
        id: "I12-borrar-una-entrada-sin-pagar",
        tipo: "eliminacion",
        objetivo: "deuda",
        descripcion:
          "El cambio borra del registro la entrada de `a.ts` y los marcadores siguen: se «borró» la deuda sin pagarla.",
        esperado: { codigo: "deuda-entrada-borrada", archivo: "a.ts", linea: 1 },
      },
      {
        id: "I12-la-base-ve-la-entrada-borrada-sin-pagar",
        tipo: "eliminacion",
        objetivo: "base-y-pr",
        descripcion:
          "La base tenía una entrada de `x.ts` (un TODO) y el pull request la borra con el TODO todavía en el archivo: lo ve el detector de la base.",
        esperado: { codigo: "deuda-entrada-borrada-sin-pagar", archivo: "x.ts", linea: 1 },
      },
      {
        id: "I12-la-base-deja-pagar-la-deuda",
        tipo: "alteracion",
        objetivo: "base-y-pr",
        descripcion:
          "La base tenía la entrada de `x.ts` y el pull request resuelve el TODO y borra la entrada: no falla.",
        esperado: { pasa: true },
      },
      {
        id: "I12-marcador-sin-registrar",
        tipo: "alteracion",
        objetivo: "deuda",
        descripcion:
          "Un archivo tiene un `@ts-expect-error` y ninguna entrada del registro lo cubre.",
        esperado: { codigo: "deuda-sin-registrar", archivo: "a.ts", linea: 1 },
      },
      {
        id: "I12-marcador-nuevo-sin-excepcion",
        tipo: "alteracion",
        objetivo: "deuda",
        descripcion:
          "El cambio agrega un marcador (con su entrada, sin excepción) en un archivo que no tenía deuda.",
        esperado: { codigo: "deuda-nueva-sin-excepcion", archivo: "b.ts", linea: 1 },
      },
      {
        id: "I12-el-total-sube-sin-excepcion",
        tipo: "alteracion",
        objetivo: "deuda",
        descripcion: "Un archivo con 2 marcadores pasa a tener 3, sin una excepción vigente.",
        esperado: { codigo: "deuda-total-sube", archivo: "a.ts", linea: 3 },
      },
      {
        id: "I12-tocar-un-archivo-con-deuda",
        tipo: "alteracion",
        objetivo: "deuda",
        descripcion:
          "El cambio toca `a.ts` (con `bloqueaDeudaEnArchivoTocado: true`) y le deja su deuda.",
        esperado: { codigo: "deuda-en-archivo-tocado", archivo: "a.ts", linea: 1 },
      },
      {
        id: "I12-entrada-con-un-campo-faltante",
        tipo: "alteracion",
        objetivo: "deuda",
        descripcion: "Una entrada del registro no trae su descripción.",
        esperado: {
          codigo: "deuda-entrada-invalida",
          archivo: REGISTRO_DE_DEUDA,
          lineaDe: '"descripcion"',
        },
      },
      {
        id: "I12-archivo-que-no-existe",
        tipo: "alteracion",
        objetivo: "deuda",
        descripcion: "Una entrada apunta a un archivo que no está versionado.",
        esperado: {
          codigo: "deuda-archivo-inexistente",
          archivo: REGISTRO_DE_DEUDA,
          lineaDe: { texto: '"archivos"', despuesDe: '"id": "h"' },
        },
      },
      {
        id: "I12-configuracion-invalida",
        tipo: "alteracion",
        objetivo: "deuda",
        descripcion: "El tope de excepciones de `configuracion.json` no es un entero.",
        esperado: {
          codigo: "deuda-configuracion-invalida",
          archivo: CONFIGURACION_DE_DEUDA,
          lineaDe: '"topeDeExcepciones"',
        },
      },
      {
        id: "I12-excepcion-vencida",
        tipo: "alteracion",
        objetivo: "deuda",
        descripcion: "Una excepción de deuda venció respecto del reloj.",
        esperado: { codigo: "excepcion-vencida", archivo: REGISTRO_DE_DEUDA, lineaDe: '"vence"' },
      },
      {
        id: "I12-excepcion-de-mas-de-60-dias",
        tipo: "alteracion",
        objetivo: "deuda",
        descripcion: "Una excepción de deuda dura 90 días entre su creación y su vencimiento.",
        esperado: {
          codigo: "excepcion-plazo-excesivo",
          archivo: REGISTRO_DE_DEUDA,
          lineaDe: '"vence"',
        },
      },
      {
        id: "I12-excepcion-que-no-cubre-nada",
        tipo: "alteracion",
        objetivo: "deuda",
        descripcion: "Una excepción de deuda apunta a un archivo que ya no tiene el problema.",
        esperado: { codigo: "excepcion-obsoleta", archivo: REGISTRO_DE_DEUDA, lineaDe: '"id"' },
      },
      {
        id: "I12-pasar-el-tope-de-excepciones",
        tipo: "alteracion",
        objetivo: "deuda",
        descripcion: "Hay una excepción más que el tope configurado.",
        esperado: {
          codigo: "deuda-tope-de-excepciones",
          archivo: REGISTRO_DE_DEUDA,
          lineaDe: { texto: '"id"', despuesDe: '"id": "exc-1"' },
        },
      },
      {
        id: "I12-archivo-de-datos-que-no-se-puede-leer",
        tipo: "alteracion",
        objetivo: "deuda",
        descripcion:
          "`knip.json` deja de ser JSON válido: no se pueden contar sus entradas de `ignore*`.",
        esperado: { codigo: "deuda-archivo-ilegible", archivo: "knip.json", linea: 2 },
      },
      {
        id: "I12-subir-el-tope-de-excepciones",
        tipo: "alteracion",
        objetivo: "base-y-pr",
        descripcion: "El pull request sube `topeDeExcepciones` de 10 a 11.",
        esperado: {
          codigo: "deuda-tope-subio",
          archivo: CONFIGURACION_DE_DEUDA,
          lineaDe: '"topeDeExcepciones"',
        },
      },
      {
        id: "I12-bajar-el-bloqueo-a-false",
        tipo: "alteracion",
        objetivo: "base-y-pr",
        descripcion:
          "La base tenía `bloqueaDeudaEnArchivoTocado: true` y el pull request lo deja en false.",
        esperado: {
          codigo: "deuda-bloqueo-aflojado",
          archivo: CONFIGURACION_DE_DEUDA,
          lineaDe: '"bloqueaDeudaEnArchivoTocado"',
        },
      },
      {
        id: "I12-archivo-grande-sin-registrar",
        tipo: "alteracion",
        objetivo: "deuda",
        descripcion:
          "Un archivo de código de 450 líneas (sobre el tope de 400) no tiene entrada en el registro.",
        esperado: { codigo: "deuda-sin-registrar", archivo: "src/grande.ts", linea: 401 },
      },
      {
        id: "I12-archivo-grande-crece-sobre-lo-registrado",
        tipo: "alteracion",
        objetivo: "deuda",
        descripcion:
          "Un archivo registrado con 450 líneas pasa a medir 460: el trinquete solo deja bajar.",
        esperado: { codigo: "deuda-archivo-crece", archivo: "src/grande.ts", linea: 451 },
      },
      {
        id: "I12-archivo-grande-crece-contra-la-base",
        tipo: "alteracion",
        objetivo: "deuda",
        descripcion:
          "El pull request agranda de 450 a 460 líneas un archivo grande y actualiza el tamaño del registro: la base lo ve.",
        esperado: { codigo: "deuda-total-sube", archivo: "src/grande.ts", linea: 451 },
      },
      {
        id: "I12-subir-el-tope-de-lineas",
        tipo: "alteracion",
        objetivo: "base-y-pr",
        descripcion: "El pull request sube `topeDeLineasPorArchivo` de 400 a 401.",
        esperado: {
          codigo: "deuda-tope-de-lineas-subio",
          archivo: CONFIGURACION_DE_DEUDA,
          lineaDe: '"topeDeLineasPorArchivo"',
        },
      },
      {
        id: "I12-excluir-un-archivo-del-tope",
        tipo: "exclusion",
        objetivo: "base-y-pr",
        descripcion:
          "El pull request agrega `src/otro.ts` a `excluidosDelTope` para que no cuente como archivo grande.",
        esperado: {
          codigo: "deuda-exclusion-nueva",
          archivo: CONFIGURACION_DE_DEUDA,
          lineaDe: '"ruta": "src/otro.ts"',
        },
      },
      {
        id: "I12-duplicar-el-id-de-una-entrada",
        tipo: "duplicacion",
        objetivo: "deuda",
        descripcion: "Dos entradas del registro comparten el mismo id.",
        esperado: {
          codigo: "deuda-entrada-invalida",
          archivo: REGISTRO_DE_DEUDA,
          lineaDe: { texto: '"id"', despuesDe: '"id": "ts-expect-error--a-ts"' },
          contieneMotivo: "repetido",
        },
      },
      {
        id: "I12-duplicar-un-marcador",
        tipo: "duplicacion",
        objetivo: "deuda",
        descripcion: "Se copia un `@ts-expect-error` de `a.ts` a otra línea del mismo archivo.",
        esperado: { codigo: "deuda-total-sube", archivo: "a.ts", linea: 3 },
      },
      {
        id: "I12-desconectar-el-script-deuda",
        tipo: "desconexion",
        objetivo: "base-y-pr",
        descripcion:
          "El script `deuda` del package.json pasa a `node arquitectura/deuda/deuda.cjs || true`.",
        esperado: { codigo: "script-deuda-desviado", archivo: PAQUETE, lineaDe: '"deuda"' },
      },
      {
        id: "I12-quitar-la-deuda-del-script-arquitectura",
        tipo: "desconexion",
        objetivo: "base-y-pr",
        descripcion: "Se quita `&& npm run deuda` del script `arquitectura`.",
        esperado: {
          codigo: "script-arquitectura-sin-deuda",
          archivo: PAQUETE,
          lineaDe: '"arquitectura"',
        },
      },
      {
        id: "I12-continue-on-error-en-el-paso-de-deuda",
        tipo: "desconexion",
        objetivo: "base-y-pr",
        descripcion: "El paso «Deuda técnica» agrega `continue-on-error: true`.",
        esperado: {
          codigo: "ci-deuda-con-salto",
          archivo: CI,
          lineaDe: { texto: "continue-on-error: true", despuesDe: "Deuda técnica (no crece" },
        },
      },
      {
        id: "I12-if-en-el-paso-de-deuda",
        tipo: "desconexion",
        objetivo: "base-y-pr",
        descripcion: "El paso «Deuda técnica» agrega `if: false`.",
        esperado: {
          codigo: "ci-deuda-con-salto",
          archivo: CI,
          lineaDe: { texto: "if: false", despuesDe: "Deuda técnica (no crece" },
        },
      },
      {
        id: "I12-borrar-las-pruebas-de-la-deuda",
        tipo: "desconexion",
        objetivo: "pruebas-del-guardian",
        descripcion:
          "Se borra `guardian-deuda-libro.test.ts`: las pruebas del libro de deuda no corren.",
        esperado: {
          codigo: "pruebas-del-guardian-borradas",
          archivo: "test/arquitectura/guardian-deuda-libro.test.ts",
          linea: 1,
        },
      },
      {
        id: "I12-excluir-un-archivo-del-analisis",
        tipo: "exclusion",
        noAplica:
          "El control no tiene exclusiones por configuración: analiza toda ruta versionada de las familias que conoce. Sacar un archivo del análisis es moverlo a una familia que no se analiza (.md, .txt) o ignorarlo en git, y eso es un límite declarado (la deuda no marcada no la ve ninguna máquina) que la batería de evasión registra como riesgo aceptado.",
      },
      {
        id: "I12-marcador-con-otra-capitalizacion",
        tipo: "elusion",
        objetivo: "deuda",
        descripcion:
          "El marcador se escribe `// ToDo: arreglar`: otra capitalización no lo esconde.",
        esperado: { codigo: "deuda-sin-registrar", archivo: "b.ts", linea: 1 },
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

/**
 * Los códigos que un invariante conoce y puede nombrar: los del guardián, los de los verificadores del
 * mecanismo, los de la vigilancia de la versión anterior (`no-debilitar.cjs`) y los del control de deuda técnica.
 */
function codigosConocidos(codigosDeFalla) {
  return new Set([
    ...codigosDeFalla,
    ...CODIGOS_DE_MECANISMO,
    ...CODIGOS_DE_VIGILANCIA,
    ...CODIGOS_DE_DEUDA,
  ]);
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
        "Restituí el invariante: la matriz tiene que cubrir I1 a I12.",
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
