import { describe, expect, it } from "vitest";
import { CONTROLES_DE_CAJA } from "../../src/modulos/caja/publico";
import { aporteDeVentas } from "../../src/modulos/ventas/publico";
import { CONTROLES_DE_STOCK } from "../../src/modulos/stock/publico";
import type { CierreParaLaPantalla } from "../../src/capacidades/experiencia/vista-del-cierre";
import {
  CONTROLES_QUE_NO_SE_MUESTRAN,
  TEXTO_DE_CONTROL,
  armarElModeloDelCierre,
  esErrorDelModelo,
  type AccionesDelCierre,
  type ModeloDelCierre,
} from "../../apps/web/ui/plantillas/cierre/modelo-del-cierre";
import { CATALOGO_DE_TEXTOS } from "../../src/capacidades/vocabulario/catalogo";

/**
 * El modelo de vista de «Cierre del día» (maqueta aceptada, tres pasos): lo que se ve de lo que entrega la composición. Puro. Todo nace cerrado: un control solo se muestra con su texto
 * aprobado, los tres de stock no se muestran (DDD:183), cualquier OTRO control sin texto hace fallar el modelo entero, y un botón sale apagado sin el permiso de su acción.
 */

const TODO: AccionesDelCierre = {
  empezar: true,
  cancelar: true,
  cerrar: true,
  corregirMedio: true,
  declarar: true,
};
const NADA: AccionesDelCierre = {
  empezar: false,
  cancelar: false,
  cerrar: false,
  corregirMedio: false,
  declarar: false,
};

const cierre = (cambios: Partial<CierreParaLaPantalla> = {}): CierreParaLaPantalla => ({
  fechaDeNegocio: "2026-11-09",
  estado: "ABIERTA",
  cerradaPor: null,
  cerradaEn: null,
  huella: "huella-1",
  controles: [],
  conciliacion: null,
  cobros: null,
  medios: [],
  ...cambios,
});

const control = (cambios: Record<string, unknown> = {}) => ({
  modulo: "caja",
  clave: "caja.diferencia_de_arqueo",
  severidad: "RECONOCIBLE" as const,
  cantidad: 1,
  reconocido: false,
  reconocidoPor: null,
  reconocidoEn: null,
  texto: null,
  ...cambios,
});

const modelo = (c: CierreParaLaPantalla, a: AccionesDelCierre = TODO): ModeloDelCierre => {
  const m = armarElModeloDelCierre(c, a);
  if (esErrorDelModelo(m)) throw new Error(`se esperaba el modelo y vino ${m.error}`);
  return m;
};

const linea = (cambios: Record<string, unknown> = {}) => ({
  medioDePagoId: "m1",
  cuentaDeCobroId: "c1",
  medioTipo: "TARJETA_DEBITO",
  medioNombre: null,
  cuentaNombre: "Posnet 1",
  registrado: "7070.00",
  correcciones: "0.00",
  declarado: null,
  estadoDeConteo: "SIN_DATO" as const,
  diferencia: null,
  ...cambios,
});

describe("el estado y la fecha", () => {
  it.each([
    ["ABIERTA", "ABIERTA", "Abierta", "exito"],
    ["SIN_ACTIVIDAD", "ABIERTA", "Abierta", "exito"],
    ["EN_AUDITORIA", "EN_AUDITORIA", "En cierre", "aviso"],
    ["CERRADA", "CERRADA", "Cerrada", "exito"],
  ] as const)("%s se ve como %s: «%s»", (estado, vista, etiqueta, tono) => {
    const m = modelo(cierre({ estado }));
    expect(m).toMatchObject({ estado: vista, etiquetaDeEstado: etiqueta, tonoDeEstado: tono });
  });

  it("la fecha se muestra DD/MM/AAAA y la de negocio queda como AAAA-MM-DD para mandarla al servidor", () => {
    expect(modelo(cierre({ fechaDeNegocio: "2026-03-05" }))).toMatchObject({
      fecha: "05/03/2026",
      fechaDeNegocio: "2026-03-05",
    });
  });

  it("una fecha inválida o un estado desconocido hacen fallar el modelo (la pantalla sale con el genérico)", () => {
    expect(armarElModeloDelCierre(cierre({ fechaDeNegocio: "ayer" }), TODO)).toEqual({
      error: "FECHA_INVALIDA",
    });
    expect(armarElModeloDelCierre(cierre({ fechaDeNegocio: "2026-02-30" }), TODO)).toEqual({
      error: "FECHA_INVALIDA",
    });
    expect(armarElModeloDelCierre(cierre({ estado: "ARCHIVADA" as never }), TODO)).toEqual({
      error: "ESTADO_DESCONOCIDO",
    });
    expect(armarElModeloDelCierre(cierre({ estado: "toString" as never }), TODO)).toEqual({
      error: "ESTADO_DESCONOCIDO",
    });
    expect(esErrorDelModelo({ error: "FECHA_INVALIDA" })).toBe(true);
    expect(esErrorDelModelo(modelo(cierre()))).toBe(false);
  });

  it("«quién cerró»: la persona y la hora en Argentina; sin persona conocida no se muestra la línea", () => {
    const cerrada = cierre({
      estado: "CERRADA",
      cerradaPor: "lucia@ejemplo.com",
      cerradaEn: "2026-11-10T01:30:00.000Z",
    });
    expect(modelo(cerrada).cerradaPor).toBe("lucia@ejemplo.com · 09/11/2026 22:30");
    expect(modelo({ ...cerrada, cerradaPor: null }).cerradaPor).toBeNull();
    expect(modelo({ ...cerrada, cerradaEn: null }).cerradaPor).toBeNull();
  });

  it("lleva la huella del servidor tal cual y los permisos de los botones", () => {
    expect(modelo(cierre({ huella: "abc" }), NADA)).toMatchObject({
      huella: "abc",
      acciones: NADA,
    });
  });
});

describe("los controles", () => {
  it("se agrupan por severidad: lo que impide cerrar, lo que hay que reconocer y lo que solo informa", () => {
    const m = modelo(
      cierre({
        controles: [
          control({
            modulo: "ventas",
            clave: "ventas.cuentas_abiertas",
            severidad: "BLOQUEA",
            cantidad: 2,
          }),
          control({ clave: "caja.diferencia_de_arqueo", severidad: "RECONOCIBLE", cantidad: 1 }),
          control({
            modulo: "ventas",
            clave: "ventas.anulaciones",
            severidad: "INFORMA",
            cantidad: 5,
          }),
        ],
      }),
    );
    expect(m.bloquean.map((c) => [c.rotulo, c.cantidad, c.clave, c.modulo])).toEqual([
      ["Cuentas abiertas sin cobrar", 2, "ventas.cuentas_abiertas", "ventas"],
    ]);
    expect(m.porReconocer.map((c) => [c.rotulo, c.cantidad])).toEqual([
      ["Diferencias de arqueo", 1],
    ]);
    expect(m.informan.map((c) => [c.rotulo, c.cantidad])).toEqual([["Anulaciones", 5]]);
  });

  it("un control sin hallazgos (cantidad 0) no se muestra, ni siquiera sin texto", () => {
    const m = modelo(
      cierre({
        controles: [
          control({ cantidad: 0 }),
          control({ clave: "algo.nuevo", cantidad: 0 }),
          control({ clave: "ventas.cortesias", modulo: "ventas", cantidad: -1 }),
        ],
      }),
    );
    expect([...m.bloquean, ...m.porReconocer, ...m.informan]).toEqual([]);
  });

  it("los tres controles de stock y los tickets a cuenta corriente no se muestran en esta versión (no tienen texto aprobado)", () => {
    const m = modelo(
      cierre({
        controles: [
          ...Object.values(CONTROLES_DE_STOCK).map((clave) =>
            control({ modulo: "stock", clave, severidad: "INFORMA", cantidad: 4 }),
          ),
          control({
            modulo: "ventas",
            clave: "ventas.tickets_a_cuenta_corriente",
            severidad: "INFORMA",
            cantidad: 2,
          }),
        ],
      }),
    );
    expect(m.informan).toEqual([]);
    expect([...CONTROLES_QUE_NO_SE_MUESTRAN].sort()).toEqual(
      [...Object.values(CONTROLES_DE_STOCK), "ventas.tickets_a_cuenta_corriente"].sort(),
    );
  });

  it.each(["BLOQUEA", "RECONOCIBLE", "INFORMA"] as const)(
    "un control %s sin texto aprobado hace fallar el modelo: no se esconde lo que exige actuar ni se muestra una clave cruda",
    (severidad) => {
      expect(
        armarElModeloDelCierre(
          cierre({
            controles: [
              control({ clave: "reservas.sin_confirmar", modulo: "reservas", severidad }),
            ],
          }),
          TODO,
        ),
      ).toEqual({ error: "CONTROL_SIN_TEXTO" });
    },
  );

  it("un nombre heredado de Object.prototype tampoco es un control conocido", () => {
    expect(
      armarElModeloDelCierre(cierre({ controles: [control({ clave: "constructor" })] }), TODO),
    ).toEqual({ error: "CONTROL_SIN_TEXTO" });
  });

  it("con el día cerrado, el control reconocido lleva «Reconocido por …» con la persona y la hora, y la observación; sin persona conocida, nada", () => {
    const m = modelo(
      cierre({
        estado: "CERRADA",
        controles: [
          control({
            reconocido: true,
            reconocidoPor: "tomas@ejemplo.com",
            reconocidoEn: "2026-11-10T01:40:00.000Z",
            texto: "Se explicó",
          }),
          control({
            clave: "ventas.cortesias",
            modulo: "ventas",
            reconocido: true,
            reconocidoPor: null,
            reconocidoEn: "2026-11-10T01:40:00.000Z",
            texto: null,
          }),
          control({
            clave: "ventas.tickets_por_cobrar",
            modulo: "ventas",
            reconocido: false,
            reconocidoPor: "otro@ejemplo.com",
            reconocidoEn: "2026-11-10T01:40:00.000Z",
            texto: "no va",
          }),
        ],
      }),
    );
    expect(m.porReconocer.map((c) => [c.rotulo, c.constancia, c.observacion])).toEqual([
      [
        "Diferencias de arqueo",
        "Reconocido por tomas@ejemplo.com · 09/11/2026 22:40",
        "Se explicó",
      ],
      ["Cortesías", null, null],
      ["Tickets por cobrar", null, null],
    ]);
  });

  it("«Cobrado contra el ticket» lista cada ticket con su diferencia; sin número, solo la diferencia; en los demás controles no hay detalle", () => {
    const m = modelo(
      cierre({
        estado: "EN_AUDITORIA",
        controles: [
          control({ clave: "caja.cobrado_contra_ticket", cantidad: 2 }),
          control({ clave: "caja.diferencia_de_arqueo", cantidad: 1 }),
        ],
        conciliacion: {
          enVivo: true,
          lineas: [],
          cobradoContraTicket: [
            { ticketNumero: 7, diferencia: "2000.00" },
            { ticketNumero: null, diferencia: "-1.50" },
          ],
        },
      }),
    );
    expect(m.porReconocer.map((c) => [c.rotulo, c.detalle])).toEqual([
      ["Cobrado contra el ticket", ["Ticket 7 · Diferencia $ 2.000,00", "Diferencia -$ 1,50"]],
      ["Diferencias de arqueo", []],
    ]);
  });

  it("todos los controles de caja y de ventas tienen su texto aprobado, y todos los textos existen en el catálogo", async () => {
    const delModuloDeVentas = new Set<string>();
    const vacio = () => Promise.resolve([]);
    const r = await aporteDeVentas.controles(
      {
        lecturasDeVentas: {
          cuentasAbiertas: vacio,
          ticketsDeLaJornada: vacio,
          cortesiasDeLaJornada: vacio,
          anulacionesDeLaJornada: vacio,
          correccionesDeLaJornada: vacio,
        },
      },
      { empresaId: "e", sucursalId: "s", fechaDeNegocio: "2026-11-09" } as never,
    );
    if (!r.ok) throw new Error("ventas no respondió");
    for (const c of r.valor) delModuloDeVentas.add(c.clave);
    const delModuloDeCaja = Object.values(CONTROLES_DE_CAJA).map((c) => c.clave);
    // El control de los tickets a cuenta corriente (CC-2) EXISTE en el servidor pero no se muestra (sin texto aprobado): no figura en los textos y la pantalla del cierre no se rompe.
    expect(delModuloDeVentas.has("ventas.tickets_a_cuenta_corriente")).toBe(true);
    const visibles = [...delModuloDeCaja, ...delModuloDeVentas].filter(
      (clave) => !CONTROLES_QUE_NO_SE_MUESTRAN.has(clave),
    );
    expect(visibles.sort()).toEqual(Object.keys(TEXTO_DE_CONTROL).sort());
    for (const clave of Object.values(TEXTO_DE_CONTROL))
      expect(Object.hasOwn(CATALOGO_DE_TEXTOS, clave)).toBe(true);
  });
});

describe("la conciliación por medio", () => {
  const conLineas = (...lineas: ReturnType<typeof linea>[]) =>
    modelo(
      cierre({
        estado: "EN_AUDITORIA",
        conciliacion: { enVivo: true, lineas, cobradoContraTicket: [] },
      }),
    ).lineas;

  it("sin conciliación (jornada abierta) no hay líneas", () => {
    expect(modelo(cierre()).lineas).toBeNull();
  });

  it("el efectivo muestra lo contado y no se declara; la diferencia a favor va como aviso y la que falta como peligro", () => {
    const [mas, menos, justo] =
      conLineas(
        linea({
          medioTipo: "EFECTIVO",
          cuentaNombre: null,
          cuentaDeCobroId: null,
          registrado: "1250.00",
          declarado: "1300.00",
          estadoDeConteo: "CONTADO",
          diferencia: "50.00",
        }),
        linea({
          medioTipo: "EFECTIVO",
          medioDePagoId: "m2",
          estadoDeConteo: "CONTADO",
          declarado: "1200.00",
          diferencia: "-50.00",
        }),
        linea({
          medioTipo: "EFECTIVO",
          medioDePagoId: "m3",
          estadoDeConteo: "CONTADO",
          declarado: "1250.00",
          diferencia: "0.00",
        }),
      ) ?? [];
    expect(mas).toMatchObject({
      titulo: "Efectivo",
      cuenta: null,
      registrado: "$ 1.250,00",
      declarado: "$ 1.300,00",
      declarable: false,
      declaradoCanonico: "",
      diferencia: "$ 50,00",
      tonoDeDiferencia: "aviso",
    });
    expect(menos).toMatchObject({ diferencia: "-$ 50,00", tonoDeDiferencia: "peligro" });
    expect(justo).toMatchObject({ diferencia: "$ 0,00", tonoDeDiferencia: "neutro" });
  });

  it("un medio sin declarar es «Sin declarar» y se puede declarar; ya declarado muestra el total y lo precarga como texto canónico", () => {
    const [sin, declarado] =
      conLineas(
        linea({ medioNombre: "Visa", cuentaNombre: "Posnet 1" }),
        linea({
          medioDePagoId: "m2",
          estadoDeConteo: "DECLARADO",
          declarado: "7070.00",
          diferencia: "0.00",
        }),
      ) ?? [];
    expect(sin).toMatchObject({
      clave: "m1|c1",
      medioDePagoId: "m1",
      cuentaDeCobroId: "c1",
      titulo: "Visa",
      cuenta: "Posnet 1",
      registrado: "$ 7.070,00",
      declarado: null,
      declarable: true,
      declaradoCanonico: "",
      diferencia: "Sin declarar",
      tonoDeDiferencia: "neutro",
    });
    expect(declarado).toMatchObject({
      titulo: "Tarjeta de débito",
      declarado: "$ 7.070,00",
      declarable: true,
      declaradoCanonico: "7070.00",
      diferencia: "$ 0,00",
    });
  });

  it("sin un total que mostrar (contado o declarado pero sin importe) no se muestra nada ni se precarga: el texto vacío, nunca «null»", () => {
    const [contado, declarado] =
      conLineas(
        linea({ medioDePagoId: "a", estadoDeConteo: "CONTADO", declarado: null }),
        linea({ medioDePagoId: "b", estadoDeConteo: "DECLARADO", declarado: null }),
      ) ?? [];
    expect(contado).toMatchObject({ declarado: null, declaradoCanonico: "" });
    expect(declarado).toMatchObject({ declarado: null, declaradoCanonico: "" });
  });

  it("«Conforme» no muestra un total y no precarga nada; la clave de una línea sin cuenta no deja un hueco ambiguo", () => {
    const [conforme] =
      conLineas(
        linea({
          estadoDeConteo: "CONFORME",
          declarado: "99.00",
          cuentaDeCobroId: null,
          cuentaNombre: null,
        }),
      ) ?? [];
    expect(conforme).toMatchObject({
      clave: "m1|",
      declarado: null,
      declaradoCanonico: "",
      diferencia: "Conforme",
      tonoDeDiferencia: "neutro",
    });
  });

  it("la fila de correcciones solo se dibuja si hubo (cero en cualquier forma no cuenta)", () => {
    const ls =
      conLineas(
        linea({ medioDePagoId: "a", correcciones: "0.00" }),
        linea({ medioDePagoId: "b", correcciones: "0" }),
        linea({ medioDePagoId: "c", correcciones: "-0.00" }),
        linea({ medioDePagoId: "d", correcciones: "-18400.00" }),
        linea({ medioDePagoId: "e", correcciones: "100.00" }),
        linea({ medioDePagoId: "f", correcciones: "0.01" }),
        linea({ medioDePagoId: "g", correcciones: "10.00" }),
      ) ?? [];
    expect(ls.map((l) => l.correcciones)).toEqual([
      null,
      null,
      null,
      "-$ 18.400,00",
      "$ 100,00",
      "$ 0,01",
      "$ 10,00",
    ]);
  });

  it("el nombre propio del medio manda sobre el del tipo", () => {
    const [propio, deTipo] =
      conLineas(
        linea({ medioNombre: "Mi débito" }),
        linea({ medioDePagoId: "z", medioNombre: null }),
      ) ?? [];
    expect([propio?.titulo, deTipo?.titulo]).toEqual(["Mi débito", "Tarjeta de débito"]);
  });
});

describe("los cobros", () => {
  const cobro = (cambios: Record<string, unknown> = {}) => ({
    cobroId: "k1",
    importe: "18400.00",
    medioDePagoId: "m1",
    cuentaDeCobroId: "c1",
    medioTipo: "TARJETA_CREDITO",
    medioNombre: null,
    cuentaNombre: "Posnet 1",
    registradoPor: "lucia@ejemplo.com",
    correccionPosible: true,
    ultimaCorreccion: null,
    ...cambios,
  });
  const conCobros = (a: AccionesDelCierre, ...cobros: ReturnType<typeof cobro>[]) =>
    modelo(cierre({ estado: "EN_AUDITORIA", cobros: { cobros, hayMas: false } }), a).cobros;

  it("sin cobros leídos (jornada abierta) no hay lista", () => {
    expect(modelo(cierre()).cobros).toBeNull();
    expect(modelo(cierre()).hayMasCobros).toBe(false);
  });

  it("cada cobro con su importe, quién lo registró y el medio vigente con su cuenta; sin cuenta, solo el medio", () => {
    const [con, sin] =
      conCobros(
        TODO,
        cobro(),
        cobro({
          cobroId: "k2",
          cuentaNombre: null,
          cuentaDeCobroId: null,
          medioTipo: "EFECTIVO",
          registradoPor: null,
        }),
      ) ?? [];
    expect(con).toMatchObject({
      cobroId: "k1",
      importe: "$ 18.400,00",
      medioDePagoId: "m1",
      cuentaDeCobroId: "c1",
      medio: "Tarjeta de crédito · Posnet 1",
      registradoPor: "lucia@ejemplo.com",
      corregidoPor: null,
      motivo: null,
    });
    expect(sin).toMatchObject({ medio: "Efectivo", registradoPor: null, cuentaDeCobroId: null });
  });

  it("«Corregir medio» se ofrece solo si el servidor dice que se puede Y la persona tiene el permiso", () => {
    const quePuede = (a: AccionesDelCierre, posible: boolean) =>
      conCobros(a, cobro({ correccionPosible: posible }))?.[0]?.puedeCorregir;
    expect([
      quePuede(TODO, true),
      quePuede(TODO, false),
      quePuede(NADA, true),
      quePuede(NADA, false),
    ]).toEqual([true, false, false, false]);
  });

  it("un cobro corregido lleva «Corregido por {persona} · {fecha y hora}» y el motivo; sin persona conocida, solo el motivo", () => {
    const [uno, dos] =
      conCobros(
        TODO,
        cobro({
          ultimaCorreccion: {
            por: "tomas@ejemplo.com",
            en: "2026-11-10T01:20:00.000Z",
            motivo: "Era débito",
          },
        }),
        cobro({
          cobroId: "k2",
          ultimaCorreccion: { por: null, en: "2026-11-10T01:20:00.000Z", motivo: "Otro" },
        }),
      ) ?? [];
    expect(uno).toMatchObject({
      corregidoPor: "Corregido por tomas@ejemplo.com · 09/11/2026 22:20",
      motivo: "Era débito",
    });
    expect(dos).toMatchObject({ corregidoPor: null, motivo: "Otro" });
  });

  it("dice si hay más cobros de los que se muestran", () => {
    expect(
      modelo(cierre({ estado: "EN_AUDITORIA", cobros: { cobros: [], hayMas: true } })).hayMasCobros,
    ).toBe(true);
  });
});

describe("las opciones de «Corregir medio»", () => {
  it("cada medio con su nombre y sus cuentas, tal como las ofrece el servidor", () => {
    const m = modelo(
      cierre({
        estado: "EN_AUDITORIA",
        medios: [
          { medioDePagoId: "ef", tipo: "EFECTIVO", nombre: null, cuentas: [] },
          {
            medioDePagoId: "de",
            tipo: "TARJETA_DEBITO",
            nombre: "Visa débito",
            cuentas: [{ cuentaDeCobroId: "t1", nombre: "Posnet 1" }],
          },
        ],
      }),
    );
    expect(m.medios).toEqual([
      { medioDePagoId: "ef", titulo: "Efectivo", cuentas: [] },
      { medioDePagoId: "de", titulo: "Visa débito", cuentas: [{ id: "t1", nombre: "Posnet 1" }] },
    ]);
  });
});
