import pg from "pg";
// Con extensión `.ts` a propósito: lo carga `scripts/migrar-base.ts` directamente con Node.
import { describirFallaDeBase } from "./describir-falla-de-base.ts";
import { ErrorDeMigracion, hostConPooler } from "./migraciones.ts";
import { claveAlAzar, type RolPorPreparar } from "./roles-de-la-aplicacion.ts";

/**
 * Da LOGIN y una contraseña al azar a los roles de la aplicación que todavía no tienen LOGIN (nacen
 * NOLOGIN en las migraciones, ver 0001). Es idempotente: un rol que ya tiene LOGIN no se toca ni se le
 * cambia la contraseña, salvo con `rotar`.
 *
 * - Un bloqueo de sesión propio serializa dos corridas simultáneas: sin él, las dos verían «sin LOGIN»,
 *   cada una pondría su contraseña y solo una de las dos quedaría vigente (la otra se imprimiría en vano).
 * - Primero se comprueba que TODOS los roles existan (si falta uno no se toca ninguno). Después cada rol
 *   va en su PROPIA transacción: si uno falla, los anteriores ya quedaron activos y el error trae sus
 *   contraseñas para que se muestren igual (nunca queda un rol activo con una contraseña que nadie vio), y
 *   al repetir el comando solo se toca el que faltó.
 * - La contraseña viaja en claro dentro de la sentencia (por TLS) y la hashea el servidor: Neon solo acepta
 *   contraseñas en texto (rechaza un verificador SCRAM ya calculado: «Received HTTP code 400 from control
 *   plane»). Es una contraseña de un solo uso que se genera acá y no se guarda en ningún archivo.
 * - Cualquier falla se cuenta SIN el texto original del error (que podría repetir la sentencia con la
 *   contraseña): solo el rol y el código SQLSTATE; con `diagnostico` se suma el mensaje del servidor con
 *   todo lo secreto tapado.
 */

const CLAVE_DE_BLOQUEO = 7_340_002;

/** Hereda de `ErrorDeMigracion`: su mensaje es propio y seguro, y se muestra tal cual. */
export class ErrorDePreparacion extends ErrorDeMigracion {
  /** Los roles que ya quedaron activos antes de la falla (con su contraseña, que hay que mostrar). */
  readonly preparados: readonly RolPreparado[];

  constructor(mensaje: string, preparados: readonly RolPreparado[] = []) {
    super(mensaje);
    this.name = "ErrorDePreparacion";
    this.preparados = preparados;
  }
}

export type RolPreparado = Readonly<{
  rol: string;
  variable: string;
  /** `nuevo`: sin LOGIN antes; `rotado`: tenía LOGIN y se pidió rotar; `intacto`: ya tenía LOGIN y no se tocó. */
  estado: "nuevo" | "rotado" | "intacto";
  /** La contraseña recién generada: solo en `nuevo` y `rotado`. */
  clave?: string;
}>;

export type OpcionesDePreparacion = Readonly<{
  roles: readonly RolPorPreparar[];
  rotar: boolean;
  /** Se inyecta en las pruebas; por defecto, `claveAlAzar` con `crypto.randomBytes`. */
  generarClave?: () => string;
  /**
   * Con `diagnostico`, una falla inesperada agrega el mensaje del servidor (sin cadena de conexión,
   * sin la contraseña generada y sin tiras largas) para poder encontrar la causa. Por defecto no: el
   * mensaje original puede repetir lo que se mandó.
   */
  diagnostico?: boolean;
}>;

/** Lo único que se muestra de una falla inesperada en modo diagnóstico, sin nada que sirva de credencial. */
function detalleDeDiagnostico(falla: unknown, urlDirecta: string, clave: string): string {
  const texto = describirFallaDeBase(falla, urlDirecta).replace(/SCRAM-SHA-256\$\S+/g, "***");
  return clave === "" ? texto : texto.split(clave).join("***");
}

function codigoDe(falla: unknown): string {
  const code = (falla as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : "sin código";
}

export async function prepararRoles(
  urlDirecta: string,
  opciones: OpcionesDePreparacion,
): Promise<RolPreparado[]> {
  if (hostConPooler(urlDirecta)) {
    throw new ErrorDePreparacion("la cadena apunta al pooler: usá la cadena directa");
  }
  const generar = opciones.generarClave ?? (() => claveAlAzar());
  const cliente = new pg.Client({ connectionString: urlDirecta, connectionTimeoutMillis: 30_000 });
  cliente.on("error", () => undefined);
  await cliente.connect();
  const resultado: RolPreparado[] = [];
  let rolActual = "";
  let paso = "consulta del rol";
  let clave = "";
  try {
    await cliente.query("SELECT pg_advisory_lock($1)", [CLAVE_DE_BLOQUEO]);
    // Primero se mira a todos: si falta uno, no se toca ninguno.
    const conLogin = new Map<string, boolean>();
    for (const { rol } of opciones.roles) {
      rolActual = rol;
      const fila = await cliente.query<{ puede: boolean }>(
        "SELECT rolcanlogin AS puede FROM pg_roles WHERE rolname = $1",
        [rol],
      );
      const existente = fila.rows[0];
      if (existente === undefined) {
        throw new ErrorDePreparacion(
          `el rol ${rol} no existe: faltan aplicar las migraciones que lo crean`,
        );
      }
      conLogin.set(rol, existente.puede);
    }
    for (const { rol, variable } of opciones.roles) {
      rolActual = rol;
      const puede = conLogin.get(rol) === true;
      if (puede && !opciones.rotar) {
        resultado.push({ rol, variable, estado: "intacto" });
        continue;
      }
      paso = "generación de la contraseña";
      clave = generar();
      await cliente.query("BEGIN");
      try {
        paso = "armado de la sentencia";
        const sentencia = await cliente.query<{ sentencia: string }>(
          "SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', $1::text, $2::text) AS sentencia",
          [rol, clave],
        );
        paso = "ALTER ROLE";
        await cliente.query(sentencia.rows[0]?.sentencia ?? "");
        await cliente.query("COMMIT");
      } catch (falla) {
        await cliente.query("ROLLBACK").catch(() => undefined);
        throw falla;
      }
      resultado.push({ rol, variable, estado: puede ? "rotado" : "nuevo", clave });
      clave = "";
    }
    return resultado;
  } catch (falla) {
    if (falla instanceof ErrorDePreparacion) throw falla;
    const diagnostico =
      opciones.diagnostico === true
        ? ` Diagnóstico (paso: ${paso}): ${detalleDeDiagnostico(falla, urlDirecta, clave)}`
        : "";
    const yaActivos = resultado.some((r) => r.clave !== undefined);
    throw new ErrorDePreparacion(
      `no se pudo dar LOGIN al rol ${rolActual} (SQLSTATE ${codigoDe(falla)}); ` +
        (yaActivos
          ? "los roles anteriores ya quedaron activos (sus contraseñas se muestran abajo): al repetir el comando solo se toca el que falta."
          : "no se cambió ninguna contraseña.") +
        diagnostico,
      resultado,
    );
  } finally {
    await cliente.end();
  }
}
