import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import {
  errorDeCodigo,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import { tocar, violacionesDeAccesibilidad } from "../../pruebas/ayudas";
import { enArmazon, ventana } from "./ayudas-de-pruebas";
import { FormularioDeDatosFiscales } from "./FormularioDeDatosFiscales.cliente";
import type { BorradorDeDatosFiscales } from "./modelo-de-datos-fiscales";

/**
 * Ingresos Brutos en Datos fiscales (D-115/D-116, opción B), en Chromium con las acciones simuladas: el desplegable «Ingresos Brutos»,
 * el campo «Número de inscripción» que aparece solo con esa opción, y los errores del servidor marcados en su lugar con el foco.
 * Previene: pedir un número a quien es «No contribuyente», perder el número al guardar y un error de Ingresos Brutos que no se ve.
 */
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const guardar = vi.fn<(pedido: unknown) => Promise<Respuesta<{ version: number }>>>();
const confirmar = vi.fn<(pedido: unknown) => Promise<Respuesta<unknown>>>();

const LISTA = "/configuracion-fiscal";
const DOMICILIO = {
  id: "d1",
  calle: "Av. Rivadavia",
  numero: "1234",
  piso: null,
  departamento: null,
  localidad: "Ciudad de Buenos Aires",
  provincia: "AR-C",
  codigoPostal: "1000",
};
const BORRADOR: BorradorDeDatosFiscales = {
  id: "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b",
  version: 4,
  razonSocial: "Distribuidora Sur SA",
  condicionIva: "RESPONSABLE_INSCRIPTO",
  domicilio: DOMICILIO,
  inicioActividades: "2018-03-01",
  iibbNumero: null,
  iibbCondicion: null,
};

const formulario = (borrador: BorradorDeDatosFiscales | null = BORRADOR) => (
  <FormularioDeDatosFiscales
    emisorId="2d1b8c3a-4e5f-4a71-8c9d-1e2f3a4b5c6d"
    cuit="30712345678"
    borrador={borrador}
    vigente={null}
    hoy="2026-11-05"
    condicionesDeIva={[{ valor: "RESPONSABLE_INSCRIPTO", etiqueta: "IVA Responsable Inscripto" }]}
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

const boton = (nombre: string) => page.getByRole("button", { name: nombre });
const desplegable = () => page.getByLabelText("Ingresos Brutos", { exact: true });
const numero = () => page.getByLabelText("Número de inscripción", { exact: true });
const conCampo = (campo: string): Respuesta<never> => ({
  ok: false,
  error: { ...errorDeCodigo("FISCAL_CONFIGURACION_DATOS_INVALIDOS"), campo },
});

describe("el desplegable y el campo del número", () => {
  it("el desplegable se llama «Ingresos Brutos», su opción vacía invita a elegir y ofrece las dos opciones; sin elegir no hay campo", async () => {
    await render(formulario(null));
    const opciones = (desplegable().element() as HTMLSelectElement).options;
    expect([...opciones].map((o) => o.textContent)).toEqual([
      "Elegí una opción",
      "Número de inscripción",
      "No contribuyente",
    ]);
    await expect.element(numero()).not.toBeInTheDocument();
  });

  it("el campo aparece solo con «Número de inscripción» y «No contribuyente» lo oculta", async () => {
    await render(formulario(null));
    await desplegable().selectOptions("NUMERO");
    await expect.element(numero()).toBeVisible();
    await numero().fill("901-123456-7");
    await desplegable().selectOptions("NO_CONTRIBUYENTE");
    await expect.element(numero()).not.toBeInTheDocument();
    await desplegable().selectOptions("NUMERO");
    // Volver a «Número de inscripción» conserva lo escrito.
    await expect.element(numero()).toHaveValue("901-123456-7");
  });

  it("se abre con lo guardado: el número con su campo, o «No contribuyente» sin campo", async () => {
    const { unmount } = await render(formulario({ ...BORRADOR, iibbNumero: "901-123456-7" }));
    await expect.element(desplegable()).toHaveValue("NUMERO");
    await expect.element(numero()).toHaveValue("901-123456-7");
    await unmount();
    await render(formulario({ ...BORRADOR, iibbCondicion: "NO_CONTRIBUYENTE" }));
    await expect.element(desplegable()).toHaveValue("NO_CONTRIBUYENTE");
    await expect.element(numero()).not.toBeInTheDocument();
  });

  it("va entre el domicilio y «Inicio de actividades»", async () => {
    await render(formulario(null));
    const orden = [...document.querySelectorAll("input, select")].map(
      (c) => (c as HTMLInputElement).labels?.[0]?.textContent ?? "",
    );
    expect(orden.indexOf("Código postal")).toBeLessThan(orden.indexOf("Ingresos Brutos"));
    expect(orden.indexOf("Ingresos Brutos")).toBeLessThan(orden.indexOf("Inicio de actividades"));
  });

  it.each([390, 1280])(
    "a %i px, con el campo del número visible: sin violaciones",
    async (ancho) => {
      await ventana(ancho);
      await render(
        enArmazon("Datos fiscales", formulario({ ...BORRADOR, iibbNumero: "901-123456-7" })),
      );
      expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    },
  );
});

describe("lo que se guarda", () => {
  it("el número se guarda recortado y «No contribuyente» manda la condición y borra el número", async () => {
    guardar.mockResolvedValue({ ok: true, dato: { version: 5 } });
    await render(formulario());
    await desplegable().selectOptions("NUMERO");
    await numero().fill(" 901-123456-7 ");
    tocar(boton("Guardar borrador"));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LISTA));
    expect(guardar.mock.calls[0]?.[0]).toMatchObject({
      versionEsperada: 4,
      iibbNumero: "901-123456-7",
    });
    expect(guardar.mock.calls[0]?.[0]).not.toHaveProperty("iibbCondicion");
  });

  it("«No contribuyente» sale sin número", async () => {
    guardar.mockResolvedValue({ ok: true, dato: { version: 5 } });
    await render(formulario());
    await desplegable().selectOptions("NO_CONTRIBUYENTE");
    tocar(boton("Guardar borrador"));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith(LISTA));
    expect(guardar.mock.calls[0]?.[0]).toMatchObject({ iibbCondicion: "NO_CONTRIBUYENTE" });
    expect(guardar.mock.calls[0]?.[0]).not.toHaveProperty("iibbNumero");
  });
});

describe("errores del servidor (D-116)", () => {
  it.each(["ingresosBrutos", "iibbCondicion"])(
    "con el campo %s queda marcado y enfocado el desplegable, con «Revisá los datos marcados.»",
    async (campo) => {
      guardar.mockResolvedValue({ ok: true, dato: { version: 5 } });
      confirmar.mockResolvedValue(conCampo(campo));
      await render(formulario());
      tocar(boton("Confirmar"));
      await expect.element(desplegable()).toHaveAttribute("aria-invalid", "true");
      await vi.waitFor(() => expect(document.activeElement).toBe(desplegable().element()));
      expect(
        document.getElementById(desplegable().element().getAttribute("aria-describedby") ?? "")
          ?.textContent,
      ).toBe("Revisá los datos marcados.");
      expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(1);
    },
  );

  it("con el campo iibbNumero queda marcado el número, con el foco", async () => {
    guardar.mockResolvedValue(conCampo("iibbNumero"));
    await render(formulario({ ...BORRADOR, iibbNumero: "901-123456-7" }));
    tocar(boton("Guardar borrador"));
    await expect.element(numero()).toHaveAttribute("aria-invalid", "true");
    await vi.waitFor(() => expect(document.activeElement).toBe(numero().element()));
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(1);
  });

  it("al elegir otra opción, el error se va; y sin violaciones de accesibilidad con el error marcado", async () => {
    guardar.mockResolvedValue(conCampo("ingresosBrutos"));
    await render(enArmazon("Datos fiscales", formulario()));
    tocar(boton("Guardar borrador"));
    await expect.element(desplegable()).toHaveAttribute("aria-invalid", "true");
    expect(await violacionesDeAccesibilidad(document.body, { pagina: true })).toEqual([]);
    await desplegable().selectOptions("NO_CONTRIBUYENTE");
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });
});
