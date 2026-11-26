import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { crearDirectorioDePartes } from "../../clientes/publico";
import { calcularComprobante, discriminaIva } from "../dominio/comprobante";
import { razonSocialDeLaParte } from "../dominio/factura";
import { decidirPorHuella } from "../dominio/huella";
import { esUuid } from "../dominio/identificadores";
import { huellaDeLaNotaDeCredito, leerNotaDeCredito } from "../dominio/nota-de-credito";
import { motivoDeAnulacionDesdeTexto } from "../dominio/registrar-compra";
import { anularLaNotaDeCredito, asentarLaNotaDeCredito } from "./cargo-de-la-factura";
import { autorizar, traducir } from "./comun";
import type { DependenciasDeCompras, TxDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";
import { exigirTresVias } from "./nivel-tres-vias";

type R<S> = Resultado<S, ErrorDeCompras>;

const directorio = crearDirectorioDePartes();

/** Lo que pide cargar una nota de crédito: la factura que corrige, la nota como dice el papel (`leerNotaDeCredito`) y la clave del gesto. */
export type EntradaDeRegistrarNotaDeCredito = Readonly<{
  /** Un UUID que genera la pantalla al abrir: es la idempotencia de la nota. */
  clave: string;
  proveedorId: string;
  /** La factura del mismo proveedor que la nota corrige. */
  facturaId: string;
  nota: unknown;
}>;

export type SalidaDeRegistrarNotaDeCredito = Readonly<{
  comprobanteId: string;
  /** `true`: la misma nota ya estaba cargada (misma clave y mismo contenido): no se escribió ni se auditó nada. */
  yaExistia: boolean;
}>;

/**
 * Cargar la nota de crédito que mandó el proveedor (N4, E9 §3.8): un comprobante de la clase NOTA_DE_CREDITO que corrige UNA factura del mismo proveedor, SIN saldo: no tiene líneas, no se
 * concilia, no reduce lo que se paga y no toca stock (el libro de saldos va aparte). Guard `notas_de_credito_de_proveedor.registrar` (gerente y administrador); la empresa en N4 con la perilla
 * de tres vías; el punto de venta tiene que estar en la ficha del proveedor, como en una factura. Los importes por alícuota los calcula `calcularComprobante` (el total del papel que no coincide
 * se guarda igual: el papel dice lo que dice). La factura tiene que existir en la empresa, estar registrada y ser del proveedor, y lo acreditado por todas sus notas vigentes no puede pasar de su
 * total (`NOTA_DE_CREDITO_EXCEDE_LA_FACTURA`; lo impone la base, que bloquea la factura: dos notas a la vez se serializan). Repetición: misma clave y misma huella devuelve lo hecho
 * (`yaExistia`) sin escribir ni auditar; misma clave con otro contenido, `CLAVE_REUTILIZADA`; la misma nota (tipo, punto de venta y número del mismo proveedor) con otra clave,
 * `COMPROBANTE_YA_REGISTRADO` con la ganadora.
 */
export function armarRegistrarNotaDeCredito(dependencias: DependenciasDeCompras) {
  return async function registrarNotaDeCredito(
    contexto: ContextoOperativo,
    entrada: EntradaDeRegistrarNotaDeCredito,
  ): Promise<R<SalidaDeRegistrarNotaDeCredito>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    if (!esUuid(entrada.clave) || !esUuid(entrada.proveedorId) || !esUuid(entrada.facturaId)) {
      return err("IDENTIFICADOR_INVALIDO");
    }
    const leida = leerNotaDeCredito(entrada.nota);
    if (!leida.ok) return leida;
    const nota = leida.valor;
    const huella = huellaDeLaNotaDeCredito(entrada.proveedorId, entrada.facturaId, nota);

    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDeRegistrarNotaDeCredito>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, [
            "notas_de_credito_de_proveedor.registrar",
          ]);
          if (!permiso.ok) return permiso;
          const nivel = await exigirTresVias(tx, contexto);
          if (!nivel.ok) return nivel;

          const repetida = await repeticion(tx, empresaId, entrada.clave, huella);
          if (repetida !== null) return repetida;
          const proveedor = await directorio.parteParaOperacion(
            tx,
            empresaId,
            entrada.proveedorId,
            "PROVEEDOR",
          );
          if (!proveedor.ok) return err("PROVEEDOR_NO_ENCONTRADO");
          // La factura que corrige (la base lo vuelve a comprobar bajo bloqueo; acá se dice con su nombre y sin escribir nada).
          const factura = await tx.comprobantesDeProveedor.obtener(empresaId, entrada.facturaId);
          if (factura === null || factura.clase !== "FACTURA") {
            return err("NOTA_DE_CREDITO_SIN_FACTURA");
          }
          if (factura.proveedorId !== proveedor.valor.id) {
            return err("NOTA_DE_CREDITO_DE_OTRO_PROVEEDOR");
          }
          if (factura.estado === "ANULADO") return err("NOTA_DE_CREDITO_DE_FACTURA_ANULADA");
          const duplicada = await tx.comprobantesDeProveedor.porDuplicado(
            empresaId,
            proveedor.valor.id,
            nota.tipo,
            nota.puntoDeVenta,
            nota.numero,
          );
          if (duplicada !== null) {
            return err({ error: "COMPROBANTE_YA_REGISTRADO", comprobanteId: duplicada.id });
          }
          const ficha = await tx.fichasDeCompra.obtener(empresaId, proveedor.valor.id);
          if (
            ficha === null ||
            !ficha.puntosDeVenta.some((p) => p.numero === nota.puntoDeVenta && p.activo)
          ) {
            return err("PUNTO_DE_VENTA_NO_DECLARADO");
          }
          const condicion = discriminaIva(nota.tipo)
            ? await dependencias.ivaDeLaEmpresa.condicion(tx, contexto)
            : null;
          const calculado = calcularComprobante({
            tipo: nota.tipo,
            // Un importe por alícuota es una línea de cantidad uno: el IVA lo calcula la misma cuenta exacta de la factura.
            lineas: nota.importes.map((i) => ({
              cantidadFacturada: "1",
              precioNeto: i.neto,
              alicuota: i.alicuota,
            })),
            totalSegunFactura: nota.totalSegunNota,
            condicionDeLaEmpresa: condicion,
          });
          if (!calculado.ok) return calculado;
          const c = calculado.valor;

          const comprobanteId = await tx.comprobantesDeProveedor.insertar(empresaId, {
            proveedorId: proveedor.valor.id,
            clase: "NOTA_DE_CREDITO",
            comprobanteAsociadoId: factura.id,
            tipo: nota.tipo,
            puntoDeVenta: nota.puntoDeVenta,
            numero: nota.numero,
            fechaDelComprobante: nota.fecha,
            fechaDeVencimientoDePago: null,
            netoGravado: c.netoGravado,
            noGravado: c.noGravado,
            exento: c.exento,
            iva: c.iva,
            tributosTotal: c.tributosTotal,
            // El tratamiento fiscal de la nota (crédito fiscal del IVA) no está verificado con el contador: se guarda cero, no se supone (D-32).
            creditoFiscalComputable: "0.00",
            totalCalculado: c.totalCalculado,
            totalSegunFactura: c.totalSegunFactura,
            proveedorCuit:
              proveedor.valor.documento?.tipo === "CUIT" ? proveedor.valor.documento.numero : null,
            proveedorRazonSocial: razonSocialDeLaParte(
              proveedor.valor.nombre,
              proveedor.valor.apellido,
            ),
            letraNoEsperada: false,
            nivel: "TRES_VIAS",
            esAtajo: false,
            clave: entrada.clave,
            huella,
            registradoPor: persona,
          });
          if (comprobanteId === undefined) {
            // Perdió una carrera: otra transacción ya escribió la misma clave o la misma nota. Se vuelve a mirar (ya está confirmada su fila).
            const ganadora = await repeticion(tx, empresaId, entrada.clave, huella);
            if (ganadora !== null) return ganadora;
            const igual = await tx.comprobantesDeProveedor.porDuplicado(
              empresaId,
              proveedor.valor.id,
              nota.tipo,
              nota.puntoDeVenta,
              nota.numero,
            );
            if (igual !== null) {
              return err({ error: "COMPROBANTE_YA_REGISTRADO", comprobanteId: igual.id });
            }
            throw new Error(
              "la nota de crédito chocó con una restricción única que no es la clave ni el duplicado",
            );
          }
          await tx.detalleDeComprobantes.insertarImportes(
            empresaId,
            comprobanteId,
            c.importesPorAlicuota,
          );
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "NOTA_DE_CREDITO_REGISTRADA",
            entidad: "comprobante_de_proveedor",
            entidadId: comprobanteId,
            despues: {
              proveedorId: proveedor.valor.id,
              facturaId: factura.id,
              tipo: nota.tipo,
              puntoDeVenta: nota.puntoDeVenta,
              numero: nota.numero,
              totalSegunNota: c.totalSegunFactura,
              importes: c.importesPorAlicuota.length,
            },
          });
          // Al final: la nota en el libro, contra el cargo de su factura (ver `asentarLaNotaDeCredito`).
          const enElLibro = await asentarLaNotaDeCredito(tx, contexto, dependencias, {
            notaId: comprobanteId,
            facturaId: factura.id,
            importe: c.totalSegunFactura,
          });
          if (!enElLibro.ok) return enElLibro;
          return ok({ comprobanteId, yaExistia: false });
        },
      ),
    );
  };
}

/** ¿Ya estaba? Por la clave: misma huella, repetida; otra, reutilizada. `null` si es nueva. */
async function repeticion(
  tx: Pick<TxDeCompras, "comprobantesDeProveedor">,
  empresaId: ContextoOperativo["empresaId"],
  clave: string,
  huella: string,
): Promise<R<SalidaDeRegistrarNotaDeCredito> | null> {
  const previa = await tx.comprobantesDeProveedor.porClave(empresaId, clave);
  if (previa === null) return null;
  if (decidirPorHuella(previa.huella, huella) !== "REPETIDA") return err("CLAVE_REUTILIZADA");
  return ok({ comprobanteId: previa.id, yaExistia: true });
}

export type EntradaDeAnularNotaDeCredito = Readonly<{ comprobanteId: string; motivo: string }>;
export type SalidaDeAnularNotaDeCredito = Readonly<{
  /** `true`: la nota ya estaba anulada: no se escribió ni se auditó nada. */
  yaEstaba: boolean;
}>;

/**
 * Anular una nota de crédito (N4), con motivo: queda con quién, cuándo y por qué, nada se borra y lo que acreditaba vuelve a la factura (el número de la nota queda libre). Guard
 * `notas_de_credito_de_proveedor.anular` (gerente y administrador). Completa lo hecho: no pide la perilla. Una ya anulada no escribe (`yaEstaba`); una factura u otro comprobante no es una
 * nota (`NOTA_DE_CREDITO_NO_ENCONTRADA`). La nota se bloquea: dos anulaciones a la vez dejan una sola.
 */
export function armarAnularNotaDeCredito(dependencias: DependenciasDeCompras) {
  return async function anularNotaDeCredito(
    contexto: ContextoOperativo,
    entrada: EntradaDeAnularNotaDeCredito,
  ): Promise<R<SalidaDeAnularNotaDeCredito>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    if (!esUuid(entrada.comprobanteId)) return err("NOTA_DE_CREDITO_NO_ENCONTRADA");
    const motivo = motivoDeAnulacionDesdeTexto(entrada.motivo);
    if (!motivo.ok) return motivo;
    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDeAnularNotaDeCredito>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, [
            "notas_de_credito_de_proveedor.anular",
          ]);
          if (!permiso.ok) return permiso;
          // Orden de bloqueo: la factura, después la nota (documentado en `cargo-de-la-factura.ts`).
          const sinBloquear = await tx.comprobantesDeProveedor.obtener(
            empresaId,
            entrada.comprobanteId,
          );
          if (
            sinBloquear?.clase !== "NOTA_DE_CREDITO" ||
            sinBloquear.comprobanteAsociadoId === null
          ) {
            return err("NOTA_DE_CREDITO_NO_ENCONTRADA");
          }
          await tx.comprobantesDeProveedor.bloquear(empresaId, sinBloquear.comprobanteAsociadoId);
          const nota = await tx.comprobantesDeProveedor.bloquear(empresaId, entrada.comprobanteId);
          if (nota === null || nota.clase !== "NOTA_DE_CREDITO") {
            return err("NOTA_DE_CREDITO_NO_ENCONTRADA");
          }
          if (nota.estado === "ANULADO") return ok({ yaEstaba: true });
          const hecho = await tx.comprobantesDeProveedor.anular(empresaId, nota.id, {
            por: persona,
            en: contexto.ahora,
            motivo: motivo.valor,
          });
          if (!hecho) throw new Error("la nota ya no estaba registrada bajo bloqueo");
          const enElLibro = await anularLaNotaDeCredito(tx, contexto, dependencias, nota.id);
          if (!enElLibro.ok) return enElLibro;
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "NOTA_DE_CREDITO_ANULADA",
            entidad: "comprobante_de_proveedor",
            entidadId: nota.id,
            antes: { estado: "REGISTRADO" },
            despues: { estado: "ANULADO", motivo: motivo.valor },
          });
          return ok({ yaEstaba: false });
        },
      ),
    );
  };
}
