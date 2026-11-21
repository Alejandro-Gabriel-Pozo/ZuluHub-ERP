import {
  sonPartesValidas,
  type PartesDeDireccion,
} from "../../../capacidades/activos/direccion-externa";
import {
  esCaraDeVidriera,
  type CaraDeVidriera,
} from "../../../capacidades/experiencia/vidriera/caras";
import {
  CATALOGO_DE_MODELOS_DE_VIDRIERA,
  MODELO_DE_RESERVA,
  esModeloDeVidriera,
  type ModeloDeVidriera,
} from "../../../capacidades/experiencia/vidriera/modelos";
import { CATALOGO_DE_PERILLAS } from "../../../capacidades/planes/perillas";
import { COLOR_RRGGBB } from "../../../primitivas/color/contraste";
import { exigirAcciones } from "../../../capacidades/permisos/exigir";
import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import { exigirPerilla } from "../../../capacidades/planes/derechos";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { sucursalId, type SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  codigoDeCartaDesdeTexto,
  lugarDeCartaDesdeTexto,
  mensajeDePortadaDesdeTexto,
  nombreDeCartaDesdeTexto,
  rubroDeCartaDesdeTexto,
} from "../../../primitivas/texto/datos-de-carta-publica";
import type { MotivoDeTextoInvalido } from "../../../primitivas/texto/texto-de-una-linea";
import type { CartaPublica, EstadoDeCarta } from "../dominio/carta-publica";
import { cartaPublicaId, esUuid } from "../dominio/identificadores";
import { autorizar, exigirAlcanceTotal, exigirSucursalAbierta, traducir } from "./comun";
import type { DependenciasDeCatalogo, TxDeCatalogo } from "./contrato";
import type { ErrorDeCatalogo } from "./errores";
import { visibilidadDeLaCarta } from "./visibilidad-de-la-carta";

type R<S> = Resultado<S, ErrorDeCatalogo>;

export type EntradaDeGuardarCartaPublica = Readonly<{
  /** Lo manda la aplicación: es la idempotencia del alta y la semilla de la dirección de cada producto. */
  id: string;
  sucursalId: string;
  nombre: string;
  /** Opcionales: `undefined`, `null` o el vacío se guardan como `null` (sin esa línea). */
  rubro?: string | null;
  lugar?: string | null;
  /** La tercera línea de la portada (texto libre); vacío = sin mensaje. */
  mensajeDePortada?: string | null;
  estado: EstadoDeCarta;
  /**
   * Identidad de la carta (0077). Como el rubro: ausente o vacío es «sin elegir» (`LISTA`, y sin cara, sin color propio y sin logo propio = usa lo de la empresa);
   * si trae algo tiene que ser de la lista permitida o tener la forma exacta. El color se guarda COMO LO ELIGIÓ la persona (`#rrggbb` en minúsculas): el
   * ajuste por contraste se calcula al mostrar y no se guarda. El logo llega en PARTES (las que lee `leerDireccionPegada`), nunca como dirección.
   */
  modelo?: string | null;
  cara?: string | null;
  colorPropio?: string | null;
  logo?: PartesDeDireccion | null;
  /** Obligatoria para CAMBIAR una carta que ya existe; repetir lo ya guardado no la pide. */
  versionEsperada?: number;
}>;

export type SalidaDeGuardarCartaPublica = Readonly<{
  cartaId: string;
  codigo: string;
  estado: EstadoDeCarta;
  version: number;
  /** `true` si no se escribió nada: la carta ya estaba así (un clic doble, un reintento). */
  yaExistia: boolean;
}>;

type Datos = Readonly<{
  nombre: string;
  rubro: string | null;
  lugar: string | null;
  mensajeDePortada: string | null;
  estado: EstadoDeCarta;
  modelo: ModeloDeVidriera;
  cara: CaraDeVidriera | null;
  colorPropio: string | null;
  logo: PartesDeDireccion | null;
}>;

/** Un texto o una elección opcional: ausente o en blanco es `null`. */
const enBlanco = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/** El logo recibido, rearmado con SOLO las cinco partes y validado con la regla única de `direccion-externa.ts`; cualquier otra cosa se rechaza. */
function logoValido(v: unknown): R<PartesDeDireccion | null> {
  if (v === undefined || v === null) return ok(null);
  if (typeof v !== "object") return err("LOGO_DE_CARTA_INVALIDO");
  const o = v as Record<string, unknown>;
  const { proveedor, cuenta, idPublico, version, extension } = o;
  if (
    typeof proveedor !== "string" ||
    typeof cuenta !== "string" ||
    typeof idPublico !== "string" ||
    typeof version !== "string" ||
    typeof extension !== "string"
  )
    return err("LOGO_DE_CARTA_INVALIDO");
  const partes = { proveedor, cuenta, idPublico, version, extension };
  if (partes.proveedor !== "CLOUDINARY" || !sonPartesValidas(partes as PartesDeDireccion))
    return err("LOGO_DE_CARTA_INVALIDO");
  return ok({ ...partes, proveedor: "CLOUDINARY" });
}

const mismoLogo = (a: PartesDeDireccion | null, b: PartesDeDireccion | null): boolean =>
  a === null || b === null
    ? a === b
    : a.proveedor === b.proveedor &&
      a.cuenta === b.cuenta &&
      a.idPublico === b.idPublico &&
      a.version === b.version &&
      a.extension === b.extension;

/** Un texto opcional: ausente o en blanco es «sin esa línea» (`null`); si trae algo tiene que ser válido. */
function opcional(
  texto: string | null | undefined,
  convertir: (t: string) => Resultado<string, MotivoDeTextoInvalido>,
  error: ErrorDeCatalogo,
): R<string | null> {
  if (texto === undefined || texto === null || texto.trim() === "") return ok(null);
  const valido = convertir(texto);
  return valido.ok ? ok(valido.valor) : err(error);
}

function validar(entrada: EntradaDeGuardarCartaPublica): R<Datos> {
  const nombre = nombreDeCartaDesdeTexto(entrada.nombre);
  if (!nombre.ok) return err("NOMBRE_DE_CARTA_INVALIDO");
  const rubro = opcional(entrada.rubro, rubroDeCartaDesdeTexto, "RUBRO_DE_CARTA_INVALIDO");
  if (!rubro.ok) return rubro;
  const lugar = opcional(entrada.lugar, lugarDeCartaDesdeTexto, "LUGAR_DE_CARTA_INVALIDO");
  if (!lugar.ok) return lugar;
  const mensaje = opcional(
    entrada.mensajeDePortada,
    mensajeDePortadaDesdeTexto,
    "MENSAJE_DE_PORTADA_INVALIDO",
  );
  if (!mensaje.ok) return mensaje;
  if (entrada.estado !== "EN_LINEA" && entrada.estado !== "FUERA_DE_LINEA")
    return err("ESTADO_DE_CARTA_INVALIDO");
  const elModelo = enBlanco(entrada.modelo) ? MODELO_DE_RESERVA : entrada.modelo;
  if (typeof elModelo !== "string" || !esModeloDeVidriera(elModelo))
    return err("MODELO_DE_CARTA_INVALIDO");
  const laCara = enBlanco(entrada.cara) ? null : entrada.cara;
  if (laCara !== null && !esCaraDeVidriera(laCara)) return err("CARA_DE_CARTA_INVALIDA");
  const elColor = enBlanco(entrada.colorPropio) ? null : entrada.colorPropio;
  if (elColor !== null && (typeof elColor !== "string" || !COLOR_RRGGBB.test(elColor)))
    return err("COLOR_DE_CARTA_INVALIDO");
  const elLogo = logoValido(entrada.logo);
  if (!elLogo.ok) return elLogo;
  return ok({
    nombre: nombre.valor,
    rubro: rubro.valor,
    lugar: lugar.valor,
    mensajeDePortada: mensaje.valor,
    estado: entrada.estado,
    modelo: elModelo,
    cara: laCara,
    colorPropio: elColor,
    logo: elLogo.valor,
  });
}

const igual = (c: CartaPublica, d: Datos): boolean =>
  c.nombre === d.nombre &&
  c.rubro === d.rubro &&
  c.lugar === d.lugar &&
  c.mensajeDePortada === d.mensajeDePortada &&
  c.estado === d.estado &&
  c.modelo === d.modelo &&
  c.cara === d.cara &&
  c.colorPropio === d.colorPropio &&
  mismoLogo(c.logo, d.logo);

const aDato = (c: Datos | CartaPublica) => ({
  nombre: c.nombre,
  rubro: c.rubro,
  lugar: c.lugar,
  mensajeDePortada: c.mensajeDePortada,
  estado: c.estado,
  modelo: c.modelo,
  cara: c.cara,
  colorPropio: c.colorPropio,
  logo:
    c.logo === null
      ? null
      : {
          proveedor: c.logo.proveedor,
          cuenta: c.logo.cuenta,
          idPublico: c.logo.idPublico,
          version: c.logo.version,
          extension: c.logo.extension,
        },
});

/**
 * Elegir un modelo con perilla de plan (LIBRO: `vidriera_modelo_libro`; CUADRICULA: `vidriera_modelo_cuadricula`) la exige AL ELEGIRLO; volver a Lista, o seguir con el que ya tenía, no la pide (una baja
 * de plan no traba la edición de lo demás; qué modelo se DIBUJA lo decide el lector con `modeloEfectivo`). Si la perilla todavía no está declarada en el catálogo
 * de perillas, el modelo no se puede elegir (cierra): la declara la rama del Libro y esta rama la usa sin cambios.
 */
async function exigirPerillaDelModelo(
  tx: TxDeCatalogo,
  contexto: ContextoOperativo,
  modelo: ModeloDeVidriera,
): Promise<R<null>> {
  const { perilla } = CATALOGO_DE_MODELOS_DE_VIDRIERA[modelo];
  if (perilla === null) return ok(null);
  if (!Object.hasOwn(CATALOGO_DE_PERILLAS, perilla)) return err("MODELO_DE_CARTA_INVALIDO");
  return exigirPerilla(
    await tx.derechos.deLaEmpresa(contexto),
    perilla as keyof typeof CATALOGO_DE_PERILLAS,
    { empresaId: contexto.empresaId },
  );
}

/**
 * Poner la carta EN LÍNEA exige, en esta transacción y en este orden: que la sucursal exista, esté abierta y sea del alcance de quien pide; la perilla
 * `vidriera_por_qr` del plan (extra de pago); y al menos un producto que saldría. Retirarla no pide nada de esto (cerrar no se traba por una baja de plan).
 */
async function exigirPoderPonerEnLinea(
  tx: TxDeCatalogo,
  contexto: ContextoOperativo,
  sucursal: SucursalId,
): Promise<R<null>> {
  const abierta = await exigirSucursalAbierta(tx, contexto, sucursal);
  if (!abierta.ok) return abierta;
  const perilla = exigirPerilla(await tx.derechos.deLaEmpresa(contexto), "vidriera_por_qr", {
    empresaId: contexto.empresaId,
  });
  if (!perilla.ok) return perilla;
  const { salen } = await visibilidadDeLaCarta(tx, {
    empresaId: contexto.empresaId,
    sucursalId: sucursal,
    ahora: contexto.ahora,
    hastaElPrimero: true,
  });
  return salen > 0 ? ok(null) : err("CARTA_SIN_PRODUCTOS_VISIBLES");
}

/**
 * Guardar la carta pública de una sucursal (carta real §6.1): UNA acción que crea (nace `FUERA_DE_LINEA` o `EN_LINEA` si se pide), edita sus textos y la
 * pone en línea o la retira. Siempre `vidrieras.editar` y alcance TODAS; crear suma `vidrieras.crear`, ponerla en línea `vidrieras.publicar_en_linea` y
 * retirarla `vidrieras.retirar_de_linea` (los cuatro son de gerente y administrador: N-2). El `id` lo manda la aplicación: repetir el mismo alta devuelve lo
 * guardado (`yaExistia`) sin exigir versión; el código lo genera el puerto de azar SOLO al crear y no cambia nunca. Editar una carta existente exige la
 * versión. El nombre es propio de cada sucursal y libre. Una carta por sucursal: la segunda es `CARTA_DE_LA_SUCURSAL_YA_EXISTE` (la decide la base).
 */
export function armarGuardarCartaPublica(dependencias: DependenciasDeCatalogo) {
  return async function guardarCartaPublica(
    contexto: ContextoOperativo,
    entrada: EntradaDeGuardarCartaPublica,
  ): Promise<R<SalidaDeGuardarCartaPublica>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeGuardarCartaPublica>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["vidrieras.editar"]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        const pedir = (acciones: readonly [ClaveAccion, ...ClaveAccion[]]) =>
          exigirAcciones(dependencias.reglas, acciones, () => tx.autorizacion.delActor(contexto));
        if (!esUuid(entrada.id)) return err("IDENTIFICADOR_INVALIDO");
        if (!esUuid(entrada.sucursalId)) return err("SUCURSAL_NO_ENCONTRADA");
        const datos = validar(entrada);
        if (!datos.ok) return datos;
        const sucursal = sucursalId(entrada.sucursalId);
        const id = cartaPublicaId(entrada.id);

        const existente = await tx.cartasPublicas.bloquear(empresaId, id);
        if (existente !== null) {
          if (existente.sucursalId !== sucursal) return err("ID_REUTILIZADO");
          if (igual(existente, datos.valor)) return ok(salida(existente, true));
          if (entrada.versionEsperada !== existente.version) return err("VERSION_DESACTUALIZADA");
          if (datos.valor.modelo !== existente.modelo) {
            const perilla = await exigirPerillaDelModelo(tx, contexto, datos.valor.modelo);
            if (!perilla.ok) return perilla;
          }
          const cambiaElEstado = existente.estado !== datos.valor.estado;
          if (cambiaElEstado) {
            const exige = await pedir([
              datos.valor.estado === "EN_LINEA"
                ? "vidrieras.publicar_en_linea"
                : "vidrieras.retirar_de_linea",
            ]);
            if (!exige.ok) return exige;
            if (datos.valor.estado === "EN_LINEA") {
              const puede = await exigirPoderPonerEnLinea(tx, contexto, sucursal);
              if (!puede.ok) return puede;
            }
          }
          const editada = await tx.cartasPublicas.actualizar(
            empresaId,
            id,
            existente.version,
            datos.valor,
          );
          if (editada === null) return err("VERSION_DESACTUALIZADA");
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: contexto.personaId,
            accion: !cambiaElEstado
              ? "CARTA_PUBLICA_EDITADA"
              : datos.valor.estado === "EN_LINEA"
                ? "CARTA_PUBLICA_PUESTA_EN_LINEA"
                : "CARTA_PUBLICA_RETIRADA",
            entidad: "carta_publica",
            entidadId: id,
            antes: aDato(existente),
            despues: aDato(editada),
          });
          return ok(salida(editada, false));
        }

        // Alta: cada sucursal tiene UNA carta.
        const crea = await pedir(
          datos.valor.estado === "EN_LINEA"
            ? ["vidrieras.crear", "vidrieras.publicar_en_linea"]
            : ["vidrieras.crear"],
        );
        if (!crea.ok) return crea;
        const abierta = await exigirSucursalAbierta(tx, contexto, sucursal);
        if (!abierta.ok) return abierta;
        if ((await tx.cartasPublicas.deLaSucursal(empresaId, sucursal)) !== null)
          return err("CARTA_DE_LA_SUCURSAL_YA_EXISTE");
        if (datos.valor.modelo !== MODELO_DE_RESERVA) {
          const perilla = await exigirPerillaDelModelo(tx, contexto, datos.valor.modelo);
          if (!perilla.ok) return perilla;
        }
        if (datos.valor.estado === "EN_LINEA") {
          const puede = await exigirPoderPonerEnLinea(tx, contexto, sucursal);
          if (!puede.ok) return puede;
        }
        const codigo = codigoDeCartaDesdeTexto(dependencias.generarCodigoDeCarta());
        if (!codigo.ok) return err("CODIGO_DE_CARTA_INVALIDO");
        const insertada = await tx.cartasPublicas.insertar(empresaId, {
          id,
          sucursalId: sucursal,
          codigo: codigo.valor,
          ...datos.valor,
          creadoPor: contexto.personaId,
        });
        const guardada = await tx.cartasPublicas.obtener(empresaId, id);
        if (guardada === null) throw new Error("la carta recién insertada no se puede leer");
        if (!insertada) {
          // Otro pedido con el MISMO id llegó primero: es una repetición si pide lo mismo; si no, el id se reutilizó.
          return guardada.sucursalId === sucursal && igual(guardada, datos.valor)
            ? ok(salida(guardada, true))
            : err("ID_REUTILIZADO");
        }
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "CARTA_PUBLICA_CREADA",
          entidad: "carta_publica",
          entidadId: id,
          despues: { ...aDato(guardada), sucursalId: sucursal },
        });
        return ok(salida(guardada, false));
      },
    );
    return traducir(resultado);
  };
}

const salida = (c: CartaPublica, yaExistia: boolean): SalidaDeGuardarCartaPublica => ({
  cartaId: c.id,
  codigo: c.codigo,
  estado: c.estado,
  version: c.version,
  yaExistia,
});
