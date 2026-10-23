import { Router } from "express";
import { createCategory,getCategoryList,updateCategory,deleteCategory,getCategoryById } from "../../controller/inventory/productCategory.controller";
import { createProduct,getProductList,updateProduct,deleteProduct,getProductById } from "../../controller/inventory/product.controller";
import { createWarehouse, getWarehouseList, getWarehouseById, updateWarehouse, deleteWarehouse } from "../../controller/inventory/warehouse.controller";
import { validId } from "../../middleware/validId";

const router = Router();
["id"].forEach((name) => router.param(name, validId)); // galat id → 404

// Category
router.post("/category", createCategory);
router.get("/category", getCategoryList);
router.get("/category/:id", getCategoryById);
router.put("/category/:id", updateCategory);
router.delete("/category/:id", deleteCategory);

// Product
router.post("/product", createProduct);
router.get("/product", getProductList);
router.get("/product/:id", getProductById);
router.put("/product/:id", updateProduct);
router.delete("/product/:id", deleteProduct);

// Warehouse
router.post("/warehouse", createWarehouse);
router.get("/warehouse", getWarehouseList);
router.get("/warehouse/:id", getWarehouseById);
router.put("/warehouse/:id", updateWarehouse);
router.delete("/warehouse/:id", deleteWarehouse);

export default router;
