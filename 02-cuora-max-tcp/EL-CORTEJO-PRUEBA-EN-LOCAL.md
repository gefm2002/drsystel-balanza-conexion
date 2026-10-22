# El Cortejo — guía de prueba en el comercio

## Qué queda preparado

- Bridge TCP configurable para conectar desde una PC dentro de la misma LAN que la Cuora MAX.
- Diagnóstico inicial de conexión y lectura F1, sin enviar comandos de cierre.
- El prototipo de reportes F72 y su parser están en `../01.1-bridge-reportes`; el paso siguiente es integrarlos al transporte TCP cuando la respuesta y el encuadre del firmware se validen en el equipo real.
- La integración con Structura requiere configurar URL/API y credenciales del tenant. No se deben guardar secretos en Git.

## Antes de ir

1. Llevar una notebook con Node.js LTS instalado.
2. Clonar este repositorio y entrar en `02-cuora-max-tcp`.
3. Ejecutar `npm ci`.
4. Confirmar con el comercio que la Cuora MAX está conectada por Ethernet a la misma red que la notebook.
5. Obtener la IP de la balanza y confirmar el puerto de comunicación habilitado en su configuración/manual. El puerto por defecto del prototipo es un placeholder; no asumirlo.
6. Revisar que la notebook tenga acceso a esa IP/puerto y que el firewall local permita el puerto HTTP 3002.

## Prueba de conectividad

En PowerShell:

```powershell
$env:SCALE_IP="IP_REAL_DE_LA_BALANZA"
$env:SCALE_PORT="PUERTO_CONFIRMADO"
$env:SCALE_ADDRESS="0"
npm start
```

Abrir `http://localhost:3002/estado` y `http://localhost:3002/peso`.

## Prueba funcional requerida

1. Registrar la IP, puerto, dirección de protocolo y firmware que responde.
2. Hacer una venta de prueba con dos renglones en la Cuora MAX y cerrarla desde el flujo normal del operador.
3. Consultar F72 de forma repetida y verificar que devuelve todos los renglones y el mismo identificador de ticket.
4. Comprobar operador, fecha/hora, PLU, unidades/gramos e importes contra el ticket físico.
5. Repetir consulta F72: el mismo ticket no debe crear una segunda orden.
6. Cerrar otro ticket: deben quedar dos órdenes distintas pendientes de pago en Structura.
7. Abrir una orden en POS, agregar un artículo no pesable y finalizar el cobro.
8. Probar reconexión desconectando y reconectando la red, sin perder tickets pendientes.

## Seguridad de la prueba

- No invocar F32 ni ninguna función de cierre/reset de acumuladores.
- No escribir PLU ni precios en la balanza hasta confirmar la función de escritura soportada por este firmware y tener una exportación/respaldo del catálogo.
- No modificar la configuración fiscal ni conectar el SAM4S: está fuera de alcance.
- No dar por aprobada la integración hasta verificar el resultado en la balanza real y en Structura.

## Criterio de salida

La prueba queda aprobada únicamente cuando se haya comprobado el recorrido completo Cuora MAX → agente local → orden pendiente en Structura → agregado de producto no pesable → cobro POS, con dos tickets distintos, sin duplicados y con importes preservados.
