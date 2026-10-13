import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
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
 * - Todos los roles van en UNA transacción: o quedan todos con su contraseña o ninguno. Si fallara
 *   después del primero, ese rol tendría LOGIN con una contraseña que nadie vio.
 * - La contraseña NO viaja en claro al servidor: se manda el verificador SCRAM-SHA-256 ya calculado
 *   acá, así el texto de la sentencia (que Postgres puede dejar en sus registros o en `pg_stat_statements`)
 *   no contiene la contraseña. El identificador y el literal los escapa el propio servidor con `format`.
 * - Cualquier falla se cuenta SIN el texto original del error (que podría repetir sentencia o valores):
 *   solo el rol y el código SQLSTATE.
 */

const CLAVE_DE_BLOQUEO = 7_340_002;
const ITERACIONES_SCRAM = 4096;

/** Hereda de `ErrorDeMigracion`: su mensaje es propio y seguro, y se muestra tal cual. */
export class ErrorDePreparacion extends ErrorDeMigracion {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDePreparacion";
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
   * sin verificadores SCRAM y sin tiras largas) para poder encontrar la causa. Por defecto no: el
   * mensaje original puede repetir lo que se mandó.
   */
  diagnostico?: boolean;
}>;

/** Lo único que se muestra de una falla inesperada en modo diagnóstico, sin nada que sirva de credencial. */
function detalleDeDiagnostico(falla: unknown, urlDirecta: string): string {
  return describirFallaDeBase(falla, urlDirecta).replace(/SCRAM-SHA-256\$\S+/g, "***");
}

/** Verificador SCRAM-SHA-256 de Postgres (RFC 5802 / 7677) para una contraseña de solo letras y números. */
export function verificadorScram(clave: string, sal: Buffer = randomBytes(16)): string {
  const salada = pbkdf2Sync(clave, sal, ITERACIONES_SCRAM, 32, "sha256");
  const claveDelCliente = createHmac("sha256", salada).update("Client Key").digest();
  const claveGuardada = createHash("sha256").update(claveDelCliente).digest();
  const claveDelServidor = createHmac("sha256", salada).update("Server Key").digest();
  return `SCRAM-SHA-256$${ITERACIONES_SCRAM}:${sal.toString("base64")}$${claveGuardada.toString("base64")}:${claveDelServidor.toString("base64")}`;
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
  let rolActual = "";
  let paso = "consulta del rol";
  try {
    await cliente.query("SELECT pg_advisory_lock($1)", [CLAVE_DE_BLOQUEO]);
    await cliente.query("BEGIN");
    try {
      const resultado: RolPreparado[] = [];
      for (const { rol, variable } of opciones.roles) {
        rolActual = rol;
        paso = "consulta del rol";
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
        if (existente.puede && !opciones.rotar) {
          resultado.push({ rol, variable, estado: "intacto" });
          continue;
        }
        paso = "generación de la contraseña";
        const clave = generar();
        paso = "armado de la sentencia";
        const sentencia = await cliente.query<{ sentencia: string }>(
          "SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', $1::text, $2::text) AS sentencia",
          [rol, verificadorScram(clave)],
        );
        paso = "ALTER ROLE";
        await cliente.query(sentencia.rows[0]?.sentencia ?? "");
        resultado.push({ rol, variable, estado: existente.puede ? "rotado" : "nuevo", clave });
      }
      await cliente.query("COMMIT");
      return resultado;
    } catch (falla) {
      await cliente.query("ROLLBACK").catch(() => undefined);
      if (falla instanceof ErrorDePreparacion) throw falla;
      const diagnostico =
        opciones.diagnostico === true
          ? ` Diagnóstico (paso: ${paso}): ${detalleDeDiagnostico(falla, urlDirecta)}`
          : "";
      throw new ErrorDePreparacion(
        `no se pudo dar LOGIN al rol ${rolActual} (SQLSTATE ${codigoDe(falla)}); no se cambió ninguna contraseña.${diagnostico}`,
      );
    }
  } finally {
    await cliente.end();
  }
}
