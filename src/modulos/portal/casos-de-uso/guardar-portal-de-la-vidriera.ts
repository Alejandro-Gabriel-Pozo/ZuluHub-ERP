import type { ContextoOperativo } from "../../../contexto/contexto";
import { empresaId as aEmpresaId, sucursalId } from "../../../primitivas/identificadores/marca";
import { esUuidCanonico } from "../../../primitivas/identificadores/marca";
import { codigoDeCartaDesdeTexto } from "../../../primitivas/texto/datos-de-carta-publica";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  mismaTarjeta,
  mismaZona,
  mismosDatosDelPortal,
  textoDesdeCentesimas,
  validarPortal,
  type EntradaDePortal,
  type Portal,
  type PortalValidado,
} from "../dominio/portal";
import { DECLARACIONES } from "./declaraciones";
import { autorizar, exigirAlcanceTotal, traducir } from "./comun";
import type { DependenciasDePortal, TxDePortal } from "./contrato";
import type { ErrorDeGuardarPortal } from "./errores";
import type { Dato } from "../../../puertos/sin-secretos";

type R<S> = Resultado<S, ErrorDeGuardarPortal>;

export type EntradaDeGuardarPortal = EntradaDePortal &
  Readonly<{
    /** Lo manda la aplicación: es la idempotencia del alta y no cambia nunca. */
    id: string;
    /** Obligatoria para CAMBIAR un portal que ya existe; repetir lo ya guardado no la pide. */
    versionEsperada?: number;
  }>;

export type SalidaDeGuardarPortal = Readonly<{
  portalId: string;
  /** La llave pública del QR de la empresa; no cambia nunca. */
  codigo: string;
  version: number;
  /** `true` si no se escribió nada: el portal ya estaba así (un clic doble, un reintento). */
  yaExistia: boolean;
}>;

const iguales = (p: Portal, v: PortalValidado): boolean => {
  if (!mismosDatosDelPortal(p.datos, v.datos)) return false;
  // Lo no enviado se deja como está: solo cuenta lo que la entrada trae y difiere.
  const t = new Map(p.tarjetas.map((x) => [x.sucursalId, x]));
  const z = new Map(p.zonas.map((x) => [x.id, x]));
  return (
    v.tarjetas.every((x) => {
      const actual = t.get(x.sucursalId);
      return actual !== undefined && mismaTarjeta(actual, x);
    }) &&
    v.zonas.every((x) => {
      const actual = z.get(x.id);
      return actual !== undefined && mismaZona(actual, x);
    })
  );
};

/** Lo que la auditoría guarda de un portal: datos propios y cuántas tarjetas y zonas tiene (el detalle está en sus tablas, con versión). */
const aDato = (p: Portal | PortalValidado, codigo?: string): Record<string, Dato> => {
  const d = p.datos;
  return {
    ...(codigo === undefined ? {} : { codigo }),
    variante: d.variante,
    lineaSuperior: d.lineaSuperior,
    titulo: d.titulo,
    colorEncabezado: d.colorEncabezado,
    colorPagina: d.colorPagina,
    colorDetras: d.colorDetras,
    logoVisible: d.logoVisible,
    imagen: d.imagen === null ? null : `${d.imagen.cuenta}/${d.imagen.idPublico}`,
    tarjetas: p.tarjetas.map((t) => ({
      sucursalId: t.sucursalId,
      orden: t.orden,
      visible: t.visible,
    })),
    zonas: p.zonas.map((z) => ({
      id: z.id,
      sucursalId: z.sucursalId,
      x: textoDesdeCentesimas(z.x),
      y: textoDesdeCentesimas(z.y),
      ancho: textoDesdeCentesimas(z.ancho),
      alto: textoDesdeCentesimas(z.alto),
      visible: z.visible,
    })),
  };
};

async function exigirSucursalesDeLaEmpresa(
  tx: TxDePortal,
  contexto: ContextoOperativo,
  v: PortalValidado,
): Promise<R<null>> {
  const ids = new Set([
    ...v.tarjetas.map((t) => t.sucursalId),
    ...v.zonas.map((z) => z.sucursalId),
  ]);
  for (const id of ids) {
    // `obtener` filtra por la empresa del contexto: una sucursal de otra empresa es indistinguible de una inexistente.
    if ((await tx.sucursales.obtener(contexto.empresaId, sucursalId(id))) === null)
      return err("SUCURSAL_NO_ENCONTRADA");
  }
  return ok(null);
}

/**
 * Guardar el portal de la vidriera (portal de la vidriera §2.3 a §2.5): UNA acción que lo crea (uno por empresa), edita su texto, colores, imagen, tarjetas (variante A) y
 * zonas (variante B) y cambia de variante SIN perder lo cargado en la otra. Siempre `vidrieras.administrar_portal` (gerente y administrador) y alcance TODAS: el portal
 * es de toda la empresa. El `id` lo manda la aplicación: repetir el mismo alta devuelve lo guardado (`yaExistia`) sin exigir versión; el código lo genera el puerto de
 * azar SOLO al crear y no cambia nunca. Editar un portal existente exige la versión, que es la de TODO el portal (datos, tarjetas y zonas): dos ediciones a la vez se
 * turnan por el bloqueo de la fila y la que llega con la versión vieja recibe `VERSION_DESACTUALIZADA`. Las tarjetas y zonas enviadas se agregan o cambian por su
 * sucursal o su id; lo que no se envía queda como está y nunca se borra (se oculta con `visible: false`). Cada sucursal tiene que ser de la empresa.
 */
export function armarGuardarPortalDeLaVidriera(d: DependenciasDePortal) {
  return async function guardarPortalDeLaVidriera(
    contexto: ContextoOperativo,
    entrada: EntradaDeGuardarPortal,
  ): Promise<R<SalidaDeGuardarPortal>> {
    const empresa = aEmpresaId(contexto.empresaId);
    const resultado = await d.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeGuardarPortal>> => {
        const permiso = await autorizar(
          tx,
          contexto,
          d.reglas,
          DECLARACIONES.guardarPortalDeLaVidriera.accion,
        );
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        if (!esUuidCanonico(entrada.id)) return err("IDENTIFICADOR_INVALIDO");
        const validado = validarPortal(entrada);
        if (!validado.ok) return validado;
        const validadoSinImagen = validado.valor;
        const sucursales = await exigirSucursalesDeLaEmpresa(tx, contexto, validadoSinImagen);
        if (!sucursales.ok) return sucursales;

        const existente = await tx.portales.bloquearDeLaEmpresa(empresa);
        // Sin `imagen` en la entrada se conserva la que ya tiene (cambiar de variante no pierde la imagen de la B); `null` la quita.
        const v: PortalValidado =
          validadoSinImagen.conservarImagen && existente !== null
            ? {
                ...validadoSinImagen,
                datos: { ...validadoSinImagen.datos, imagen: existente.datos.imagen },
              }
            : validadoSinImagen;
        if (existente !== null) {
          if (existente.id !== entrada.id) {
            // Otro portal ya es el de la empresa (otro administrador llegó primero con otro id): repetir lo mismo no cambia nada; si no, hay que releer.
            return iguales(existente, v)
              ? ok(salida(existente, true))
              : err("VERSION_DESACTUALIZADA");
          }
          if (iguales(existente, v)) return ok(salida(existente, true));
          if (entrada.versionEsperada !== existente.version) return err("VERSION_DESACTUALIZADA");
          const cambio = await tx.portales.actualizar(
            empresa,
            existente.id,
            existente.version,
            v.datos,
          );
          if (!cambio) return err("VERSION_DESACTUALIZADA");
          await escribirHijos(tx, existente, v);
          const nuevo = await tx.portales.delaEmpresa(empresa);
          if (nuevo === null) throw new Error("el portal recién editado no se puede leer");
          await tx.auditoria.registrar({
            empresaId: empresa,
            actorPersonaId: contexto.personaId,
            accion: "PORTAL_EDITADO",
            entidad: "portal_de_empresa",
            entidadId: nuevo.id,
            antes: aDato(existente),
            despues: aDato(nuevo),
          });
          return ok(salida(nuevo, false));
        }

        // Alta: una por empresa.
        const codigo = codigoDeCartaDesdeTexto(d.generarCodigoDePortal());
        if (!codigo.ok) return err("CODIGO_DE_PORTAL_INVALIDO");
        const insertado = await tx.portales.insertar(empresa, {
          id: entrada.id,
          codigo: codigo.valor,
          datos: v.datos,
          creadoPor: contexto.personaId,
        });
        const guardado = await tx.portales.bloquearDeLaEmpresa(empresa);
        if (!insertado) {
          // El `id` ya estaba. Si es el portal de ESTA empresa y pide lo mismo, es una repetición (otro pedido con el mismo id llegó primero); si no (otro contenido o un
          // id de otra empresa, que acá ni se ve), el id se reutilizó.
          return guardado !== null && guardado.id === entrada.id && iguales(guardado, v)
            ? ok(salida(guardado, true))
            : err("ID_REUTILIZADO");
        }
        if (guardado === null) throw new Error("el portal recién insertado no se puede leer");
        await escribirHijos(tx, guardado, v);
        const completo = await tx.portales.delaEmpresa(empresa);
        if (completo === null) throw new Error("el portal recién creado no se puede leer");
        await tx.auditoria.registrar({
          empresaId: empresa,
          actorPersonaId: contexto.personaId,
          accion: "PORTAL_CREADO",
          entidad: "portal_de_empresa",
          entidadId: completo.id,
          despues: aDato(completo, completo.codigo),
        });
        return ok(salida(completo, false));
      },
    );
    return traducir(resultado);
  };
}

/** Agrega o cambia solo lo que difiere (una tarjeta o zona igual no se toca: no sube su versión). */
async function escribirHijos(tx: TxDePortal, actual: Portal, v: PortalValidado): Promise<void> {
  const empresa = aEmpresaId(actual.empresaId);
  const tarjetas = new Map(actual.tarjetas.map((t) => [t.sucursalId, t]));
  for (const t of v.tarjetas) {
    const previa = tarjetas.get(t.sucursalId);
    if (previa === undefined) await tx.portales.insertarTarjeta(empresa, actual.id, t);
    else if (!mismaTarjeta(previa, t)) await tx.portales.actualizarTarjeta(empresa, actual.id, t);
  }
  const zonas = new Map(actual.zonas.map((z) => [z.id, z]));
  for (const z of v.zonas) {
    const previa = zonas.get(z.id);
    if (previa === undefined) await tx.portales.insertarZona(empresa, actual.id, z);
    else if (!mismaZona(previa, z)) await tx.portales.actualizarZona(empresa, actual.id, z);
  }
}

const salida = (p: Portal, yaExistia: boolean): SalidaDeGuardarPortal => ({
  portalId: p.id,
  codigo: p.codigo,
  version: p.version,
  yaExistia,
});
