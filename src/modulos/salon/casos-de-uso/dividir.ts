import type { ContextoOperativo } from "../../../contexto/contexto";
import { importeAJson, type ImporteJson } from "../../../primitivas/dinero/importe";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { copiarEstadoDeComandaEnTx } from "../../comandas/publico";
import {
  abrirCuentaEnTx,
  anularLineaEnTx,
  bloquearCuentas,
  calcularLasLineas,
  copiarLineaEnTx,
  idDerivado,
  lineasDeCuenta,
} from "../../ventas/publico";
import {
  huellaDeDivision,
  planDeDivision,
  type Asignacion,
  type CopiaAHacer,
} from "../dominio/division";
import { armarComando, exigirAlcance, exigirUuid } from "./comun";
import type { DependenciasDeSalon, TxDeSalon } from "./contrato";
import {
  ANCLA_DE_PARTE,
  claseDeCuenta,
  exigirCuentaUsable,
  MOTIVO_TRASLADADA,
} from "./cuenta-de-mesa";
import type { ErrorDeSalon } from "./errores";

type R<S> = Resultado<S, ErrorDeSalon>;

export type EntradaDeDividirCuenta = Readonly<{
  /** Lo manda la pantalla: es el id de la división (idempotencia). */
  divisionId: string;
  cuentaId: string;
  /** De 2 a 4 cuentas. */
  partes: number;
  /** Una por cada línea vigente de la cuenta: entero, por unidades o compartido. */
  asignaciones: readonly Asignacion[];
}>;

export type SalidaDeDividirCuenta = Readonly<{
  divisionId: string;
  cuentas: readonly Readonly<{ numero: number; cuentaId: string; total: ImporteJson }>[];
  yaExistia: boolean;
}>;

async function totalesDeLasHijas(
  tx: TxDeSalon,
  contexto: ContextoOperativo,
  partes: readonly Readonly<{ numero: number; cuentaId: string }>[],
) {
  const cuentas: { numero: number; cuentaId: string; total: ImporteJson }[] = [];
  for (const p of partes) {
    const lineas = await lineasDeCuenta(tx, contexto.empresaId, p.cuentaId);
    cuentas.push({
      numero: p.numero,
      cuentaId: p.cuentaId,
      total: importeAJson(calcularLasLineas(lineas).total),
    });
  }
  return cuentas;
}

/**
 * `dividirCuenta` (E7 §3.9, D90 y D117): reparte los ítems de una cuenta de mesa entre 2 y 4 cuentas hijas, cada una con SU ticket, su cobro y su
 * comprobante. Una transacción serializable. Guard de todas las acciones que usa por dentro (`salon.dividir`, `cuentas.abrir`, `cuentas.anular_linea`,
 * `cuentas.agregar_linea`). VALIDA TODO ANTES DE ESCRIBIR (D117): nada sin asignar, las unidades suman, ninguna cuenta queda vacía. Cada línea vigente se
 * anula con el motivo interno `TRASLADADA` y se copia a las hijas SIN recotizar (entera, por unidades o compartida con su importe fijo: el centavo que sobra
 * va a la Cuenta 1; en un ítem compartido solo UNA hija descuenta stock), con ids derivados de la división (el reintento no crea otras) y conservando su
 * estado de comanda (lo enviado sigue enviado: no se reimprime). La cuenta madre queda ABIERTA y sin ítems como cuenta de RESERVA que sigue ocupando el
 * ancla de la mesa; se anula al cobrar la última hija. Cada hija lleva el ancla `salon.parte` con su propio id. Repetir devuelve lo hecho.
 */
async function dividir(
  tx: TxDeSalon,
  contexto: ContextoOperativo,
  persona: PersonaId,
  entrada: EntradaDeDividirCuenta,
): Promise<R<SalidaDeDividirCuenta>> {
  const { empresaId } = contexto;
  const ids = exigirUuid(entrada.divisionId, entrada.cuentaId);
  if (!ids.ok) return ids;
  const huella = huellaDeDivision({
    cuentaId: entrada.cuentaId,
    partes: entrada.partes,
    asignaciones: entrada.asignaciones,
  });

  const madre = (await bloquearCuentas(tx, empresaId, [entrada.cuentaId]))[0];
  if (madre === undefined) return err("CUENTA_NO_ENCONTRADA");
  const alcance = await exigirAlcance(tx, contexto, madre.sucursalId);
  if (!alcance.ok) return alcance;

  // Idempotencia por el id de la división: lo mismo devuelve lo hecho; el mismo id con otra cosa no se pisa.
  const previa = await tx.unionesYDivisiones.divisionPorId(empresaId, entrada.divisionId);
  if (previa !== null) {
    if (previa.cuentaMadreId !== madre.id || previa.huella !== huella)
      return err("DIVISION_ID_EN_USO");
    const partes = await tx.unionesYDivisiones.partesDeDivision(empresaId, previa.id);
    return ok({
      divisionId: previa.id,
      cuentas: await totalesDeLasHijas(tx, contexto, partes),
      yaExistia: true,
    });
  }

  const clase = exigirCuentaUsable(await claseDeCuenta(tx, contexto, madre), false);
  if (!clase.ok || clase.valor.clase !== "MESA")
    return clase.ok ? err("CUENTA_NO_ES_DE_MESA") : clase;
  if (madre.estado !== "ABIERTA") return err("CUENTA_NO_ABIERTA");
  const vigentes = (await lineasDeCuenta(tx, empresaId, madre.id)).filter(
    (l) => l.estado === "VIGENTE",
  );
  const plan = planDeDivision({
    partes: entrada.partes,
    lineas: vigentes.map((l) => ({
      lineaId: l.id,
      cantidad: l.cantidad,
      pasoDeCantidad: l.pasoDeCantidad,
      precioUnitario: l.precioUnitario,
    })),
    asignaciones: entrada.asignaciones,
  });
  if (!plan.ok) return plan;

  // Las cuentas hijas, con su ancla propia (así una mesa dividida tiene varias cuentas abiertas sin chocar con el índice de ancla de la mesa).
  const hijas = new Map<number, string>();
  for (let numero = 1; numero <= entrada.partes; numero++) {
    const cuentaId = idDerivado("salon.division", entrada.divisionId, String(numero));
    // A2c: cada hija hereda EXACTAMENTE el departamento de la madre (también «sin departamento»): dividir no es elegir de nuevo.
    const abierta = await abrirCuentaEnTx(
      tx,
      contexto,
      persona,
      {
        cuentaId,
        sucursalId: madre.sucursalId,
        ancla: { tipo: ANCLA_DE_PARTE, id: cuentaId },
        etiqueta: `Cuenta ${numero}`,
      },
      { departamentoDeLaMadre: { id: madre.departamentoId } },
    );
    if (!abierta.ok) return abierta;
    hijas.set(numero, cuentaId);
  }
  const insertada = await tx.unionesYDivisiones.insertarDivision(empresaId, {
    id: entrada.divisionId,
    sucursalId: madre.sucursalId,
    cuentaMadreId: madre.id,
    mesaId: clase.valor.mesaId,
    partes: entrada.partes,
    divididaPor: persona,
    divididaEn: contexto.ahora,
    huella,
  });
  if (!insertada) return err("DIVISION_ID_EN_USO");
  for (const [numero, cuentaId] of hijas) {
    await tx.unionesYDivisiones.insertarParte(empresaId, {
      divisionId: entrada.divisionId,
      numero,
      cuentaId,
    });
  }

  const porLinea = new Map<string, CopiaAHacer[]>();
  for (const c of plan.valor)
    porLinea.set(c.lineaOrigenId, [...(porLinea.get(c.lineaOrigenId) ?? []), c]);
  for (const linea of vigentes) {
    const anulada = await anularLineaEnTx(tx, contexto, persona, {
      cuentaId: madre.id,
      lineaId: linea.id,
      motivo: MOTIVO_TRASLADADA,
    });
    if (!anulada.ok) return anulada;
    if (anulada.valor.yaEstabaAnulada) return err("LINEA_YA_MOVIDA");
    const copias = [...(porLinea.get(linea.id) ?? [])].sort((a, b) => a.parte - b.parte);
    for (const [i, copia] of copias.entries()) {
      const destino = hijas.get(copia.parte);
      if (destino === undefined) return err("PARTES_INVALIDAS");
      const nuevaId = idDerivado(
        "salon.division",
        entrada.divisionId,
        linea.id,
        String(copia.parte),
      );
      const copiada = await copiarLineaEnTx(tx, contexto, persona, {
        lineaOrigenId: linea.id,
        cuentaDestinoId: destino,
        lineaNuevaId: nuevaId,
        cantidad: copia.cantidad,
        modo: copia.modo,
        importeFijo: copia.importeFijo,
        // Un ítem compartido se cocinó una vez: solo UNA hija (la de menor número) descuenta su stock.
        controlaStock: copia.modo === "COMPARTIDA" && i > 0 ? false : undefined,
      });
      if (!copiada.ok) return copiada;
      const comanda = await copiarEstadoDeComandaEnTx(tx, contexto, {
        lineaOrigenId: linea.id,
        lineaNuevaId: nuevaId,
        cuentaDestinoId: destino,
      });
      if (!comanda.ok) return comanda;
    }
  }
  const cuentas = await totalesDeLasHijas(
    tx,
    contexto,
    [...hijas].map(([numero, cuentaId]) => ({ numero, cuentaId })),
  );
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona,
    accion: "CUENTA_DIVIDIDA",
    entidad: "division_de_cuenta",
    entidadId: entrada.divisionId,
    despues: {
      cuentaMadreId: madre.id,
      mesaId: clase.valor.mesaId,
      partes: entrada.partes,
      cuentas: cuentas.map((c) => ({
        numero: c.numero,
        cuentaId: c.cuentaId,
        total: c.total.monto,
      })),
    },
  });
  return ok({ divisionId: entrada.divisionId, cuentas, yaExistia: false });
}

/** Dividir choca con envíos, cobros y otras operaciones sobre la misma cuenta: ante un conflicto de serialización se repite entero (lo hecho es idempotente). */
const REINTENTOS_AL_DIVIDIR = 20;

export function armarDivision(dependencias: DependenciasDeSalon) {
  const comando = armarComando({
    ...dependencias,
    transacciones: {
      ejecutar: (opciones, trabajo) =>
        dependencias.transacciones.ejecutar(
          { ...opciones, reintentos: REINTENTOS_AL_DIVIDIR },
          trabajo,
        ),
    },
  });
  return {
    dividirCuenta: comando(
      ["salon.dividir", "cuentas.abrir", "cuentas.anular_linea", "cuentas.agregar_linea"],
      dividir,
    ),
  };
}
