import { createClient } from "@supabase/supabase-js";
import { revalidateTag } from "next/cache";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { TAGS } from "lib/constants";
import {
  Cart,
  CartItem,
  Collection,
  Menu,
  Page,
  Product,
  ProductVariant,
} from "./types";

let _supabase: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (!_supabase) {
    _supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _supabase;
}

export const supabase = {
  from: (table: string) => getClient().from(table) as any,
};

// ─── CART ─────────────────────────────────────────────────────────────────────

async function buildCart(cartId: string): Promise<Cart | undefined> {
  const { data: cartItems } = await supabase
    .from("cart_items")
    .select(
      `
      id,
      quantity,
      variant:product_variants (
        id,
        title,
        price,
        currency_code,
        selected_options,
        product:products (
          id,
          handle,
          title,
          featured_image_url,
          featured_image_alt,
          featured_image_width,
          featured_image_height
        )
      )
    `
    )
    .eq("cart_id", cartId);

  if (!cartItems) return undefined;

  const lines: CartItem[] = cartItems.map((item: any) => {
    const variant = item.variant;
    const product = variant.product;
    const price = Number(variant.price);
    const totalAmount = (price * item.quantity).toFixed(2);

    return {
      id: item.id,
      quantity: item.quantity,
      cost: {
        totalAmount: {
          amount: totalAmount,
          currencyCode: variant.currency_code || "BDT",
        },
      },
      merchandise: {
        id: variant.id,
        title: variant.title,
        selectedOptions: variant.selected_options || [],
        product: {
          id: product.id,
          handle: product.handle,
          title: product.title,
          featuredImage: {
            url: product.featured_image_url || "",
            altText: product.featured_image_alt || product.title,
            width: product.featured_image_width || 800,
            height: product.featured_image_height || 800,
          },
        },
      },
    };
  });

  const totalQuantity = lines.reduce((sum, l) => sum + l.quantity, 0);
  const subtotal = lines.reduce(
    (sum, l) => sum + Number(l.cost.totalAmount.amount),
    0
  );

  return {
    id: cartId,
    checkoutUrl: "/checkout",
    cost: {
      subtotalAmount: { amount: subtotal.toFixed(2), currencyCode: "BDT" },
      totalAmount: { amount: subtotal.toFixed(2), currencyCode: "BDT" },
      totalTaxAmount: { amount: "0.00", currencyCode: "BDT" },
    },
    lines,
    totalQuantity,
  };
}

export async function createCart(): Promise<Cart> {
  const { data } = await supabase.from("carts").insert([{}] as any).select().single();
  const cartData = data as any;
  return {
    id: cartData?.id,
    checkoutUrl: "/checkout",
    cost: {
      subtotalAmount: { amount: "0.00", currencyCode: "BDT" },
      totalAmount: { amount: "0.00", currencyCode: "BDT" },
      totalTaxAmount: { amount: "0.00", currencyCode: "BDT" },
    },
    lines: [],
    totalQuantity: 0,
  };
}

export async function getCart(): Promise<Cart | undefined> {
  const cartId = (await cookies()).get("cartId")?.value;
  if (!cartId) return undefined;

  const { data: cart } = await supabase
    .from("carts")
    .select("id")
    .eq("id", cartId)
    .single();

  if (!cart) return undefined;
  return buildCart(cartId);
}

export async function addToCart(
  lines: { merchandiseId: string; quantity: number }[]
): Promise<Cart> {
  const cartId = (await cookies()).get("cartId")?.value!;

  for (const line of lines) {
    const { data: existing } = await supabase
      .from("cart_items")
      .select("id, quantity")
      .eq("cart_id", cartId)
      .eq("variant_id", line.merchandiseId)
      .single();

    if (existing) {
      await supabase
        .from("cart_items")
        .update({ quantity: existing.quantity + line.quantity })
        .eq("id", existing.id);
    } else {
      await supabase.from("cart_items").insert({
        cart_id: cartId,
        variant_id: line.merchandiseId,
        quantity: line.quantity,
      });
    }
  }

  return (await buildCart(cartId))!;
}

export async function removeFromCart(lineIds: string[]): Promise<Cart> {
  const cartId = (await cookies()).get("cartId")?.value!;
  await supabase.from("cart_items").delete().in("id", lineIds);
  return (await buildCart(cartId))!;
}

export async function updateCart(
  lines: { id: string; merchandiseId: string; quantity: number }[]
): Promise<Cart> {
  const cartId = (await cookies()).get("cartId")?.value!;

  for (const line of lines) {
    await supabase
      .from("cart_items")
      .update({ quantity: line.quantity })
      .eq("id", line.id);
  }

  return (await buildCart(cartId))!;
}

// ─── COLLECTIONS ──────────────────────────────────────────────────────────────

export async function getCollection(
  handle: string
): Promise<Collection | undefined> {
  const { data } = await supabase
    .from("collections")
    .select("*")
    .eq("handle", handle)
    .single();

  if (!data) return undefined;

  return {
    handle: data.handle,
    title: data.title,
    description: data.description || "",
    seo: {
      title: data.seo_title || data.title,
      description: data.seo_description || "",
    },
    updatedAt: data.updated_at,
    path: `/search/${data.handle}`,
  };
}

export async function getCollections(): Promise<Collection[]> {
  const { data } = await supabase
    .from("collections")
    .select("*")
    .order("title");

  const all: Collection = {
    handle: "",
    title: "All",
    description: "All products",
    seo: { title: "All", description: "All products" },
    path: "/search",
    updatedAt: new Date().toISOString(),
  };

  if (!data) return [all];

  const collections = data.map((c: any) => ({
    handle: c.handle,
    title: c.title,
    description: c.description || "",
    seo: {
      title: c.seo_title || c.title,
      description: c.seo_description || "",
    },
    updatedAt: c.updated_at,
    path: `/search/${c.handle}`,
  }));

  return [all, ...collections.filter((c) => !c.handle.startsWith("hidden"))];
}

export async function getCollectionProducts({
  collection,
  reverse,
  sortKey,
}: {
  collection: string;
  reverse?: boolean;
  sortKey?: string;
}): Promise<Product[]> {
  if (!collection) {
    return getProducts({});
  }

  const { data: col } = await supabase
    .from("collections")
    .select("id")
    .eq("handle", collection)
    .single();

  if (!col) return [];

  const { data } = await supabase
    .from("collection_products")
    .select("product:products(*)")
    .eq("collection_id", col.id)
    .order("sort_order");

  if (!data) return [];

  const products = data.map((row: any) => row.product);
  return Promise.all(products.map(buildProduct));
}

// ─── PRODUCTS ─────────────────────────────────────────────────────────────────

async function buildProduct(p: any): Promise<Product> {
  const { data: images } = await supabase
    .from("product_images")
    .select("*")
    .eq("product_id", p.id)
    .order("sort_order");

  const { data: options } = await supabase
    .from("product_options")
    .select("*")
    .eq("product_id", p.id);

  const { data: variants } = await supabase
    .from("product_variants")
    .select("*")
    .eq("product_id", p.id);

  const currency = p.currency_code || "BDT";

  return {
    id: p.id,
    handle: p.handle,
    availableForSale: p.available_for_sale,
    title: p.title,
    description: p.description || "",
    descriptionHtml: p.description_html || p.description || "",
    options: (options || []).map((o: any) => ({
      id: o.id,
      name: o.name,
      values: o.values || [],
    })),
    priceRange: {
      minVariantPrice: {
        amount: String(p.price_min || 0),
        currencyCode: currency,
      },
      maxVariantPrice: {
        amount: String(p.price_max || 0),
        currencyCode: currency,
      },
    },
    variants: (variants || []).map(
      (v: any): ProductVariant => ({
        id: v.id,
        title: v.title,
        availableForSale: v.available_for_sale,
        selectedOptions: v.selected_options || [],
        price: {
          amount: String(v.price),
          currencyCode: v.currency_code || currency,
        },
      })
    ),
    featuredImage: {
      url: p.featured_image_url || "",
      altText: p.featured_image_alt || p.title,
      width: p.featured_image_width || 800,
      height: p.featured_image_height || 800,
    },
    images: (images || []).map((img: any) => ({
      url: img.url,
      altText: img.alt_text || p.title,
      width: img.width || 800,
      height: img.height || 800,
    })),
    seo: {
      title: p.seo_title || p.title,
      description: p.seo_description || p.description || "",
    },
    tags: p.tags || [],
    updatedAt: p.updated_at,
  };
}

export async function getProduct(handle: string): Promise<Product | undefined> {
  const { data } = await supabase
    .from("products")
    .select("*")
    .eq("handle", handle)
    .single();

  if (!data) return undefined;
  return buildProduct(data);
}

export async function getProducts({
  query,
  reverse,
  sortKey,
}: {
  query?: string;
  reverse?: boolean;
  sortKey?: string;
}): Promise<Product[]> {
  let q = supabase
    .from("products")
    .select("*")
    .eq("available_for_sale", true);

  if (query) {
    q = q.ilike("title", `%${query}%`);
  }

  if (sortKey === "PRICE") {
    q = q.order("price_min", { ascending: !reverse });
  } else if (sortKey === "CREATED_AT") {
    q = q.order("updated_at", { ascending: !reverse });
  } else {
    q = q.order("title", { ascending: !reverse });
  }

  const { data } = await q;
  if (!data) return [];
  return Promise.all(data.map(buildProduct));
}

export async function getProductRecommendations(
  productId: string
): Promise<Product[]> {
  const { data } = await supabase
    .from("products")
    .select("*")
    .neq("id", productId)
    .limit(6);

  if (!data) return [];
  return Promise.all(data.map(buildProduct));
}

// ─── MENU ─────────────────────────────────────────────────────────────────────

export async function getMenu(handle: string): Promise<Menu[]> {
  if (handle === "next-js-frontend-header-menu") {
    const { data } = await supabase
      .from("collections")
      .select("handle, title")
      .limit(5);
    if (!data) return [];
    return data.map((c: any) => ({
      title: c.title,
      path: `/search/${c.handle}`,
    }));
  }

  if (handle === "next-js-frontend-footer-menu") {
    return [
      { title: "Home", path: "/" },
      { title: "All Products", path: "/search" },
    ];
  }

  return [];
}

// ─── PAGES ────────────────────────────────────────────────────────────────────

export async function getPage(handle: string): Promise<Page> {
  const { data } = await supabase
    .from("pages")
    .select("*")
    .eq("handle", handle)
    .single();

  if (!data) {
    return {
      id: "",
      title: "Not Found",
      handle,
      body: "",
      bodySummary: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    id: data.id,
    title: data.title,
    handle: data.handle,
    body: data.body || "",
    bodySummary: data.body_summary || "",
    seo: {
      title: data.seo_title || data.title,
      description: data.seo_description || "",
    },
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

export async function getPages(): Promise<Page[]> {
  const { data } = await supabase.from("pages").select("*");
  if (!data) return [];

  return data.map((p: any) => ({
    id: p.id,
    title: p.title,
    handle: p.handle,
    body: p.body || "",
    bodySummary: p.body_summary || "",
    seo: {
      title: p.seo_title || p.title,
      description: p.seo_description || "",
    },
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  }));
}

// ─── REVALIDATE ───────────────────────────────────────────────────────────────

export async function revalidate(req: NextRequest): Promise<NextResponse> {
  const secret = req.nextUrl.searchParams.get("secret");

  if (!secret || secret !== process.env.REVALIDATION_SECRET) {
    return NextResponse.json({ status: 401 });
  }

  const type = req.nextUrl.searchParams.get("type");
  if (type === "products") revalidateTag(TAGS.products, "seconds");
  if (type === "collections") revalidateTag(TAGS.collections, "seconds");

  return NextResponse.json({ status: 200, revalidated: true, now: Date.now() });
}
