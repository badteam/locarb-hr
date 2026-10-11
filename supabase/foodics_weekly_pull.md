Weekly Foodics pull for LoCarb (one week = Sunday to Saturday, dates YYYY-MM-DD).

Tools: Foodics MCP (mcp__foodic__*) and Supabase MCP (mcp__Supabase__execute_sql, project id kuvccaqlyyskuvwoykbs). Load them with ToolSearch if deferred. Large Foodics results get saved to a file; process those files with jq in Bash, never paste big data into your replies.

Foodics branch ids (our 5 branches):
959d8bc7-2ca2-4616-9c4a-367d2a2549ec, 95b7285c-d8dd-4af5-a794-fa0b1c3401e5, 977a2421-88e1-4c4e-ac29-a43c272fa787, 9d6ca12a-3acf-4fad-8fe4-c4183ab45879, 9e76bed8-3121-45c7-b937-28fdd7b63bfb

For the week FROM..TO:

1. Options (portion sizes). For EACH of the 5 branches separately call
   mcp__foodic__get_sales_by_modifier_option_report(date_from=FROM, date_to=TO, group_by="product", filters={"branches":[BRANCH]}).
   Keep only rows whose modifier_option contains a number followed by g / gm / gram / G (regex, case-insensitive: [0-9]+ ?(g|gm|gr|gram|grams)\b ).
   For each kept row build: [BRANCH, option_id, product_id, modifier_option, product, net_quantity].
   If the response says it was truncated, split the week into two halves and pull each half as its own week (both halves are imported separately with their own FROM/TO).
2. Products. One call: mcp__foodic__get_sales_by_product_report(date_from=FROM, date_to=TO, group_by="branch").
   Keep rows whose product name matches (case-insensitive): chicken|chiken|beef|steak|kebab|meat|burger|salmon|tilapia|tawook|tandoori|biriany|lava|bolognese|hawawshi|liver|philly|دجاج|لحم|سلمون|بلطي
   and whose branch_id is one of the 5 above. Build: [branch_id, product_id, product, net_quantity, net_sales].
3. Cashiers. One call: mcp__foodic__get_sales_by_cashier_report(date_from=FROM, date_to=TO, group_by="branch").
   Build: [branch_id, cashier_id, cashier, order_count, net_sales, discount_amount, void_amount, void_quantity, return_amount].
4. Save with ONE execute_sql call:
   select public.import_foodics_week('FROM','TO', '<options json array>'::jsonb, '<products json array>'::jsonb, '<cashiers json array>'::jsonb);
   Escape single quotes inside names by doubling them (').
   Never run DELETE, DROP or schema changes.
5. Report the numbers the function returned (options, products, cashiers, new_mappings).
