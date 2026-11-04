import { z } from "zod";
import { sucursalId } from "../../primitivas/identificadores/marca";

/**
 * Formas de entrada de los comandos de sucursales (R-W5): los esquemas Zod que usa la acción del
 * servidor y el formulario, para que la pantalla no importe `publico.ts` (con la persistencia) solo
 * para saber qué forma tiene un dato. SIN negocio: solo dicen de qué tipo es cada campo y lo
 * normalizan (texto de formulario → número, texto → identificador). Qué nombre de sucursal es válido,
 * si existe o si la versión quedó vieja lo decide el caso de uso, dentro de la transacción. Una clave
 * que la forma no declara se descarta: el navegador no puede colar `empresaId` ni otro dato de más.
 */

/** Un identificador de sucursal tal como llega de un formulario o de la URL. */
const idDeSucursal = z.string().trim().min(1).transform(sucursalId);

/**
 * La versión que la pantalla tenía al abrir la ficha. Un formulario manda texto (`"3"`): se aceptan
 * solo dígitos, o un entero ya numérico; nunca `"3.5"`, `"1e3"`, `"-1"`, `""` ni `true`.
 */
const versionEsperada = z
  .union([
    z.number(),
    z
      .string()
      .regex(/^\d{1,10}$/)
      .transform(Number),
  ])
  .pipe(z.number().int().min(1).max(2_147_483_647));

/**
 * El contacto opcional de la sucursal (D-98): teléfono, correo y web tal cual los escribió la persona, o
 * `null`. Ausente no se toca; `null` o en blanco lo borra. Qué es un teléfono, un correo o una web válidos
 * lo decide el dominio.
 */
const contactoDeSucursal = {
  telefono: z.string().nullable().optional(),
  correo: z.string().nullable().optional(),
  web: z.string().nullable().optional(),
};

/** `crearSucursal`: el nombre tal cual lo escribió la persona y, si hay, su contacto; el dominio lo valida. */
export const formaDeCrearSucursal = z.object({ nombre: z.string(), ...contactoDeSucursal });

/**
 * `editarSucursal`: la sucursal, la versión que se vio, el nombre y, si se cambian, la hora de corte
 * `HH:MM` de la jornada y el contacto (el dominio los valida; omitidos, no se tocan).
 */
export const formaDeEditarSucursal = z.object({
  sucursalId: idDeSucursal,
  versionEsperada,
  nombre: z.string(),
  horaDeCorte: z.string().optional(),
  ...contactoDeSucursal,
});

/** `desactivarSucursal` y `reactivarSucursal`: reciben la misma entrada, solo la sucursal. */
export const formaDeCambiarEstadoDeSucursal = z.object({ sucursalId: idDeSucursal });
