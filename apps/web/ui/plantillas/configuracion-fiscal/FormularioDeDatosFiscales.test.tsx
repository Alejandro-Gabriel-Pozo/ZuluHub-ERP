import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";
import {
  errorDeCodigo,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import {
  restaurarConexion,
  tocar,
  verificarFoco,
  violacionesDeAccesibilidad,
} from "../../pruebas/ayudas";
import { enArmazon, legibleYTocable, ventana } from "./ayudas-de-pruebas";
import { FormularioDeDatosFiscales } from "./FormularioDeDatosFiscales.cliente";
import type { BorradorDeDatosFiscales, VigenteDeDatosFiscales } from "./modelo-de-datos-fiscales";

/**
 * El formulario de Datos fiscales en Chromium: se abre con el borrador, con lo vigente o en blanco (D-88), CUIT solo para leer (D-65), los tres botones, el guardado y la
 * confirmación en dos pasos con la versión que dejó el guardado (D-61), los errores marcados en su campo con el foco en el primero
 * (D-67) y la accesibilidad en celular y escritorio. La idempotencia, la concurrencia y la espera están en
 * `FormularioDeDatosFiscales.envio.test.tsx`. Las acciones del servidor van simuladas.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const guardar = vi.fn<(pedido: unknown) => Promise<Respuesta<{ version: number }>>>();
const confirmar = vi.fn<(pedido: unknown) => Promise<Respuesta<unknown>>>();

const EMISOR = "2d1b8c3a-4e5f-4a71-8c9d-1e2f3a4b5c6d";
const LISTA = "/configuracion-fiscal";
const CONDICIONES = [
  { valor: "RESPONSABLE_INSCRIPTO", etiqueta: "IVA Responsable Inscripto" },
  { valor: "MONOTRIBUTO", etiqueta: "Responsable Monotributo" },
  { valor: "EXENTO", etiqueta: "IVA Sujeto Exento" },
];
const BORRADOR: BorradorDeDatosFiscales = {
  id: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
  version: 4,
  razonSocial: "Distribuidora Sur SA",
  condicionIva: "RESPONSABLE_INSCRIPTO",
  domicilio: {
    id: "d1",
    calle: "Av. Rivadavia",
    numero: "1234",
    piso: null,
    departamento: null,
    localidad: "Ciudad de Buenos Aires",
    provincia: "AR-C",
    codigoPostal: "1000",
  },
  inicioActividades: "2018-03-01",
};

const VIGENTE: VigenteDeDatosFiscales = {
  id: "v1",
  numero: 2,
  vigenteDesde: "2026-10-13T01:30:00.000Z",
  razonSocial: "Distribuidora Sur SA",
  condicionIva: "RESPONSABLE_INSCRIPTO",
  domicilio: BORRADOR.domicilio!,
  inicioActividades: "2018-03-01",
};

const GUARDADO = (version: number): Respuesta<{ version: number }> => ({
  ok: true,
  dato: { version },
});
const BIEN: Respuesta<unknown> = { ok: true, dato: { numero: 3 } };
const conCampo = (
  codigo: Parameters<typeof errorDeCodigo>[0],
  campo: string,
): Respuesta<never> => ({ ok: false, error: { ...errorDeCodigo(codigo), campo } });

const formulario = (
  borrador: BorradorDeDatosFiscales | null = BORRADOR,
  vigente: VigenteDeDatosFiscales | null = null,
) => (
  <FormularioDeDatosFiscales
    emisorId={EMISOR}
    cuit="30712345678"
    borrador={borrador}
    vigente={vigente}
    condicionesDeIva={CONDICIONES}
    guardar={guardar}
    confirmar={confirmar}
    rutaAlGuardar={LISTA}
    rutaAlConfirmar={LISTA}
    rutaAlCancelar={LISTA}
  />
);

beforeEach(() => {
  guardar.mockReset();
  confirmar.mockReset();
  router.push.mockReset();
  router.refresh.mockReset();
});
afterEach(async () => {
  restaurarConexion();
  await page.viewport(390, 844);
});

const boton = (nombre: string) => page.getByRole("button", { name: nombre });
const valor = (etiqueta: string) =>
  (page.getByLabelText(etiqueta, { exact: true }).element() as HTMLInputElement).value;
const pedidoGuardado = (i = 0) => guardar.mock.calls[i]?.[0] as Record<string, unknown>;

describe("accesibilidad y medidas", () => {
  it.each([390, 1280])(
    "a %i px: sin violaciones como página, legible y tocable, sin desborde lateral",
    async (ancho) => {
      await ventana(ancho);
      await render(enArmazon("Datos fiscales", formulario()));
      expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
      legibleYTocable();
    },
  );

  it.each([390, 1280])("a %i px, con los errores marcados: sin violaciones", async (ancho) => {
    await ventana(ancho);
    guardar.mockResolvedValue(conCampo("FISCAL_CONFIGURACION_DATOS_INVALIDOS", "razonSocial"));
    await render(enArmazon("Datos fiscales", formulario()));
    tocar(boton("Guardar borrador"));
    await expect
      .element(page.getByLabelText("Razón social"))
      .toHaveAttribute("aria-invalid", "true");
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
  });

  it("cada campo tiene su etiqueta, el domicilio es un grupo con su leyenda y las opciones vacías llevan el nombre del campo", async () => {
    await render(formulario(null));
    for (const etiqueta of [
      "Razón social",
      "Condición frente al IVA",
      "Calle",
      "Número",
      "Piso",
      "Departamento",
      "Localidad",
      "Provincia",
      "Código postal",
      "Inicio de actividades",
    ]) {
      await expect.element(page.getByLabelText(etiqueta, { exact: true })).toBeVisible();
    }
    await expect.element(page.getByRole("group", { name: "Domicilio" })).toBeVisible();
    const condiciones = (
      page.getByLabelText("Condición frente al IVA").element() as HTMLSelectElement
    ).options;
    expect([...condiciones].map((o) => o.textContent)).toEqual([
      "Condición frente al IVA",
      "IVA Responsable Inscripto",
      "Responsable Monotributo",
      "IVA Sujeto Exento",
    ]);
    const provincias = (page.getByLabelText("Provincia").element() as HTMLSelectElement).options;
    expect(provincias).toHaveLength(25);
    expect(provincias[0]?.textContent).toBe("Provincia");
    // Ni Ingresos Brutos (D-45) ni fecha de vigencia (D-61).
    expect(document.body.textContent).not.toMatch(/Ingresos Brutos|vigencia|Rige/i);
  });

  it("con teclado: Tab recorre en orden con el foco visible y Enter guarda el borrador (nunca confirma)", async () => {
    guardar.mockResolvedValue(GUARDADO(5));
    await render(formulario());
    await verificarFoco(page.getByLabelText("Razón social").element() as HTMLElement);
    await userEvent.tab();
    expect(document.activeElement).toBe(page.getByLabelText("Condición frente al IVA").element());
    await userEvent.tab();
    expect(document.activeElement).toBe(page.getByLabelText("Calle").element());
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(guardar).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LISTA));
    expect(confirmar).not.toHaveBeenCalled();
  });
});

describe("lo que muestra", () => {
  it("el CUIT es solo para leer (D-65) y el borrador viene precargado con la fecha en dd/mm/aaaa (D-62)", async () => {
    await render(formulario());
    await expect.element(page.getByText("30-71234567-8")).toBeVisible();
    expect(document.querySelector('input[value*="30-7"]')).toBeNull();
    expect(valor("Razón social")).toBe("Distribuidora Sur SA");
    expect(
      (page.getByLabelText("Condición frente al IVA").element() as HTMLSelectElement).value,
    ).toBe("RESPONSABLE_INSCRIPTO");
    expect(valor("Calle")).toBe("Av. Rivadavia");
    expect(valor("Número")).toBe("1234");
    expect((page.getByLabelText("Provincia").element() as HTMLSelectElement).value).toBe("AR-C");
    expect(valor("Inicio de actividades")).toBe("01/03/2018");
  });

  it("sin borrador y con algo vigente (D-88): se abre con lo vigente, sin escribir nada", async () => {
    await render(formulario(null, VIGENTE));
    expect(valor("Razón social")).toBe("Distribuidora Sur SA");
    expect(valor("Calle")).toBe("Av. Rivadavia");
    expect(valor("Inicio de actividades")).toBe("01/03/2018");
    expect((page.getByLabelText("Provincia").element() as HTMLSelectElement).value).toBe("AR-C");
    expect(guardar).not.toHaveBeenCalled();
    expect(confirmar).not.toHaveBeenCalled();
  });

  it("sin borrador y con algo vigente, «Confirmar» crea el borrador con lo que se ve (sin versión) y lo confirma", async () => {
    guardar.mockResolvedValue(GUARDADO(1));
    confirmar.mockResolvedValue(BIEN);
    await render(formulario(null, VIGENTE));
    await page.getByLabelText("Calle").fill("Av. Corrientes");
    tocar(boton("Confirmar"));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LISTA));
    expect(pedidoGuardado()).not.toHaveProperty("versionEsperada");
    expect(pedidoGuardado()).toMatchObject({
      razonSocial: "Distribuidora Sur SA",
      domicilio: { calle: "Av. Corrientes" },
    });
    expect(confirmar).toHaveBeenCalledWith(expect.objectContaining({ versionEsperada: 1 }));
  });

  it("sin borrador ni vigente (nunca hubo nada): todo en blanco", async () => {
    await render(formulario(null));
    expect(valor("Razón social")).toBe("");
    expect(valor("Inicio de actividades")).toBe("");
    expect((page.getByLabelText("Provincia").element() as HTMLSelectElement).value).toBe("");
  });
});

describe("«Guardar borrador», «Confirmar» y «Cancelar»", () => {
  it("«Guardar borrador» guarda con la versión que vio la pantalla y vuelve a la lista de Configuración fiscal, sin confirmar", async () => {
    guardar.mockResolvedValue(GUARDADO(5));
    await render(formulario());
    await page.getByLabelText("Razón social").fill("Distribuidora Sur SRL");
    tocar(boton("Guardar borrador"));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LISTA));
    expect(guardar).toHaveBeenCalledTimes(1);
    expect(pedidoGuardado()).toEqual({
      emisorId: EMISOR,
      borradorId: BORRADOR.id,
      versionEsperada: 4,
      razonSocial: "Distribuidora Sur SRL",
      condicionIva: "RESPONSABLE_INSCRIPTO",
      inicioActividades: "2018-03-01",
    });
    expect(confirmar).not.toHaveBeenCalled();
  });

  it("empezando de cero, «Guardar borrador» crea el borrador sin versión y vuelve a la lista", async () => {
    guardar.mockResolvedValue(GUARDADO(1));
    await render(formulario(null));
    await page.getByLabelText("Razón social").fill("Mi Empresa SRL");
    tocar(boton("Guardar borrador"));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LISTA));
    expect(pedidoGuardado()).not.toHaveProperty("versionEsperada");
    expect(pedidoGuardado()).toMatchObject({ razonSocial: "Mi Empresa SRL" });
  });

  it("«Confirmar» guarda y confirma con la versión que devolvió el guardado; sin fecha de vigencia (D-61)", async () => {
    guardar.mockResolvedValue(GUARDADO(5));
    confirmar.mockResolvedValue(BIEN);
    await render(formulario());
    await page.getByLabelText("Calle").fill("Av. Corrientes");
    tocar(boton("Confirmar"));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LISTA));
    expect(pedidoGuardado()).toMatchObject({
      versionEsperada: 4,
      domicilio: { tipo: "NUEVO", calle: "Av. Corrientes", numero: "1234", provincia: "AR-C" },
    });
    const pedido = confirmar.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(pedido).toMatchObject({ emisorId: EMISOR, borradorId: BORRADOR.id, versionEsperada: 5 });
    expect(typeof pedido["motivo"]).toBe("string");
    expect(pedido).not.toHaveProperty("vigenteDesde");
  });

  it("si el guardado se rechaza, no se confirma", async () => {
    guardar.mockResolvedValue(conCampo("FISCAL_CONFIGURACION_DATOS_INVALIDOS", "razonSocial"));
    await render(formulario());
    tocar(boton("Confirmar"));
    await expect
      .element(page.getByLabelText("Razón social"))
      .toHaveAttribute("aria-invalid", "true");
    expect(confirmar).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("si confirmar se rechaza después de guardar, el próximo intento parte de la versión que quedó (no choca con su propio guardado)", async () => {
    guardar.mockResolvedValueOnce(GUARDADO(5)).mockResolvedValueOnce(GUARDADO(6));
    confirmar
      .mockResolvedValueOnce(conCampo("FISCAL_CONFIGURACION_DATOS_INVALIDOS", "inicioActividades"))
      .mockResolvedValueOnce(BIEN);
    await render(formulario());
    tocar(boton("Confirmar"));
    await expect
      .element(page.getByLabelText("Inicio de actividades"))
      .toHaveAttribute("aria-invalid", "true");
    await page.getByLabelText("Inicio de actividades").fill("02/03/2018");
    tocar(boton("Confirmar"));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LISTA));
    expect(pedidoGuardado(1)).toMatchObject({
      versionEsperada: 5,
      inicioActividades: "2018-03-02",
    });
    expect(confirmar.mock.calls[1]?.[0]).toMatchObject({ versionEsperada: 6 });
  });

  it("«Cancelar» vuelve sin enviar nada", async () => {
    await render(formulario());
    tocar(boton("Cancelar"));
    expect(router.push).toHaveBeenCalledWith(LISTA);
    expect(guardar).not.toHaveBeenCalled();
    expect(confirmar).not.toHaveBeenCalled();
  });
});

describe("errores marcados en su campo (D-67)", () => {
  it("«Revisá los datos marcados.» marca el campo, queda asociado por aria-describedby y recibe el foco", async () => {
    guardar.mockResolvedValue(
      conCampo("FISCAL_CONFIGURACION_DATOS_INVALIDOS", "inicioActividades"),
    );
    await render(formulario());
    tocar(boton("Guardar borrador"));
    const campo = page.getByLabelText("Inicio de actividades");
    await expect.element(campo).toHaveAttribute("aria-invalid", "true");
    expect(
      document.getElementById(campo.element().getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe("Revisá los datos marcados.");
    await vi.waitFor(() => expect(document.activeElement).toBe(campo.element()));
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(1);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it.each([
    ["razonSocial", "Razón social"],
    ["condicionIva", "Condición frente al IVA"],
    ["domicilio.calle", "Calle"],
    ["domicilio.numero", "Número"],
    ["domicilio.piso", "Piso"],
    ["domicilio.departamento", "Departamento"],
    ["domicilio.localidad", "Localidad"],
    ["domicilio.provincia", "Provincia"],
    ["domicilio.codigoPostal", "Código postal"],
    // Falta el domicilio entero: se marca el primer campo del bloque.
    ["domicilio", "Calle"],
  ] as const)("con el campo %s marca «%s»", async (campo, etiqueta) => {
    guardar.mockResolvedValue(conCampo("FISCAL_CONFIGURACION_DATOS_INVALIDOS", campo));
    await render(formulario());
    tocar(boton("Guardar borrador"));
    const marcado = page.getByLabelText(etiqueta, { exact: true });
    await expect.element(marcado).toHaveAttribute("aria-invalid", "true");
    await vi.waitFor(() => expect(document.activeElement).toBe(marcado.element()));
  });

  it("confirmar incompleto marca el primer dato que falta y el guardado queda hecho", async () => {
    guardar.mockResolvedValue(GUARDADO(5));
    confirmar.mockResolvedValue(conCampo("FISCAL_CONFIGURACION_DATOS_INVALIDOS", "condicionIva"));
    await render(formulario());
    tocar(boton("Confirmar"));
    await expect
      .element(page.getByLabelText("Condición frente al IVA"))
      .toHaveAttribute("aria-invalid", "true");
    expect(document.body.textContent).toContain("Revisá los datos marcados.");
  });

  it("al volver a escribir en un campo marcado, el error se va", async () => {
    guardar.mockResolvedValue(conCampo("FISCAL_CONFIGURACION_DATOS_INVALIDOS", "razonSocial"));
    await render(formulario());
    tocar(boton("Guardar borrador"));
    await expect
      .element(page.getByLabelText("Razón social"))
      .toHaveAttribute("aria-invalid", "true");
    await page.getByLabelText("Razón social").fill("Otra");
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });

  it("un rechazo sin campo (sin permiso) se dice arriba con su texto, sin el código y sin marcar nada", async () => {
    guardar.mockResolvedValue({ ok: false, error: errorDeCodigo("SIN_PERMISO") });
    await render(formulario());
    tocar(boton("Guardar borrador"));
    await expect.element(page.getByText("No tiene permiso para hacer esto.")).toBeVisible();
    expect(document.body.textContent).not.toContain("SIN_PERMISO");
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });
});
