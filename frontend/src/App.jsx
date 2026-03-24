import { GoogleLogin, googleLogout } from '@react-oauth/google';
import { jwtDecode } from "jwt-decode";
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import headerImage from './header-image.png';
import { useNavigate, useParams } from 'react-router-dom';
import { addToShoppingList,
         analyzeImages,
         createRecipe,
         deleteRecipe,
         deleteRecipeImage,
         fetchRecipes,
         importFromUrl,
         setAuthToken,
         starRecipe,
         triggerExtractTimes,
         updateRecipe,
         uploadRecipeImage
     } from './api';

const API_URL = ""; 

function App() {
  const { id: recipeIdFromUrl } = useParams();
  const navigate = useNavigate();

  const [recipes, setRecipes] = useState([]);
  const [selectedRecipe, setSelectedRecipe] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [uploading, setUploading] = useState(false);
  const [user, setUser] = useState(null);
  const [cookMode, setCookMode] = useState(false);
  const [wakeLock, setWakeLock] = useState(null);
  const [targetServings, setTargetServings] = useState(null);
  const [copiedToast, setCopiedToast] = useState(false);
  const [showShoppingModal, setShowShoppingModal] = useState(false);
  const [addingToOG, setAddingToOG] = useState(false);
  
  // --- SECURITY CONFIG ---
  // Add the Google Emails of people allowed to EDIT
  const ALLOWED_EDITORS = [
    "jessicasabaramirez@gmail.com", "jessleahkirchner@gmail.com", "highlandparkmermaids@gmail.com",
    "osabaramirez@gmail.com", "stephjbee@gmail.com", "cactuslady55@gmail.com", "kirchnerwilliam07@gmail.com"
  ];

  const isEditor = user && ALLOWED_EDITORS.includes(user.email);

  // --- URL IMPORT STATE ---
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);

  // --- EDIT MODE STATE ---
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    title: "",
    tags: "",
    ingredients: "",
    instructions: "",
    source_type: "personal",
    source_title: "",
    source_url: "",
    source_page: "",
    prep_time: "",
    cook_time: "",
    total_time: "",
    servings: ""
  });

    // --- RANDOM EMOJI --- 
  const [randomEmoji] = useState(() => {
    const foodEmojis = ["🍇", "🍉", "🍊", "🍋", "🍋‍🟩", "🍍", "🥭", "🍑", "🍒", "🍓", "🫐",
                        "🥑", "🍆", "🥔", "🥕", "🧄", "🫛", "🍞", "🥐", "🥖", "🥨", "🥞",
                        "🧀", "🍖", "🍗", "🍔", "🥪", "🌮", "🥚", "🍳", "🥘", "🥗", "🥫",
                        "🍝", "🍚", "🍜", "🥟", "🥠", "🍦", "🍩", "🍪", "🎂", "🍷", "🍹",
                        "🥂", "🧉", "🥢", "🍽️", "🔪", "🏺"];
    return foodEmojis[Math.floor(Math.random() * foodEmojis.length)];
  });

// Add this useEffect near the top of your App component
  useEffect(() => {
    // Check if we have a saved token
    const savedToken = localStorage.getItem("token");
    
    if (savedToken) {
        try {
            const decoded = jwtDecode(savedToken);
            // Check if token is expired
            if (decoded.exp * 1000 < Date.now()) {
                localStorage.removeItem("token");
            } else {
                setUser(decoded);
                setAuthToken(savedToken);
            }
        } catch (e) {
            console.error("Invalid token found");
            localStorage.removeItem("token");
        }
    }
  
  loadRecipes().then(data => {
    // If the page was opened directly at /recipe/:id, auto-select that recipe
    if (recipeIdFromUrl) {
      const recipe = data.find(r => r.id === recipeIdFromUrl);
      if (recipe) setSelectedRecipe(recipe);
    }
  });
  }, []);

  // Reset serving scale when navigating to a different recipe
  useEffect(() => {
    setTargetServings(null);
  }, [selectedRecipe?.id]);

  const loadRecipes = async () => {
    try {
      const data = await fetchRecipes();
      setRecipes(data);
      return data;
    } catch (err) {
      console.error("Failed to load recipes", err);
      return [];
    }
  };

  const safeList = (list) => {
    if (!list) return [];
    if (Array.isArray(list)) return list;
    if (typeof list === 'string') return list.split(',').map(item => item.trim());
    return [];
  };

  // Parse the leading number from a servings string like "4" or "4-6 servings"
  const parseBaseServings = (servings) => {
    if (!servings) return null;
    const match = String(servings).match(/(\d+)/);
    return match ? parseInt(match[1]) : null;
  };

  // Multiply a qty string by a scale factor, formatted cleanly
  const scaleQty = (qty, factor) => {
    if (!qty || factor === 1) return qty;
    const num = parseFloat(qty);
    if (isNaN(num)) return qty;
    const scaled = num * factor;
    return scaled % 1 === 0 ? String(scaled) : parseFloat(scaled.toFixed(2)).toString();
  };

  // --- HANDLERS ---

  // 1. Manual Entry Handler
  const handleManualEntry = () => {
    setSelectedRecipe({ title: "New Recipe", ingredients: [], instructions: [], tags: [], source: { type: "personal" } });
    setEditForm({
        title: "", tags: "", ingredients: "", instructions: "",
        source_type: "personal", source_title: "", source_url: "", source_page: "",
        prep_time: "", cook_time: "", total_time: "", servings: ""
    });
    setIsEditing(true);
  };

  // Build a plain-text shopping list for the selected recipe
  const getShoppingListText = () => {
    const items = selectedRecipe?.structured_ingredients?.length > 0
      ? selectedRecipe.structured_ingredients.map(ing => {
          const parts = [ing.qty, ing.unit, ing.item].filter(Boolean);
          return `• ${parts.join(" ")}`;
        })
      : safeList(selectedRecipe?.ingredients).map(ing => `• ${ing}`);
    return `${selectedRecipe?.title}\n\n${items.join("\n")}`;
  };

  const handleCopyShoppingList = async () => {
    try {
      await navigator.clipboard.writeText(getShoppingListText());
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 2500);
    } catch (e) { console.error(e); }
  };

  const handleShareShoppingList = async () => {
    const text = getShoppingListText();
    if (navigator.share) {
      try {
        await navigator.share({ title: `${selectedRecipe?.title} — ingredients`, text });
        return;
      } catch (e) { if (e.name === "AbortError") return; }
    }
    handleCopyShoppingList();
  };

  const handleAddToOurGroceries = async () => {
    setAddingToOG(true);
    try {
      const ingredients = selectedRecipe.structured_ingredients?.length > 0
        ? selectedRecipe.structured_ingredients.map(ing => [ing.qty, ing.unit, ing.item].filter(Boolean).join(" "))
        : safeList(selectedRecipe.ingredients);
      await addToShoppingList(selectedRecipe.title, ingredients);
      setShowShoppingModal(false);
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 2500);
    } catch (err) {
      console.error(err);
      alert("Failed to add to Our Groceries. The server may not be configured yet.");
    } finally {
      setAddingToOG(false);
    }
  };

  // Navigate to a recipe (updates URL and selected state)
  const selectRecipe = (recipe) => {
    setSelectedRecipe(recipe);
    setIsEditing(false);
    navigate(`/recipe/${recipe.id}`);
  };

  // Go back to the recipe list
  const goBack = () => {
    setSelectedRecipe(null);
    navigate('/');
  };

  // Share the current recipe URL
  const handleShare = async () => {
    const url = `${window.location.origin}/recipe/${selectedRecipe.id}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: selectedRecipe.title, url });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return; // user dismissed share sheet
      }
    }
    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 2500);
    } catch (e) {
      console.error('Could not copy link', e);
    }
  };

  // Star / unstar a recipe (editor only)
  const handleStar = async (recipe, e) => {
    e.stopPropagation();
    if (!isEditor) return;
    const newStarred = !recipe.starred;
    try {
      await starRecipe(recipe.id, newStarred);
      const updated = { ...recipe, starred: newStarred };
      setRecipes(prev => prev.map(r => r.id === recipe.id ? updated : r));
      if (selectedRecipe?.id === recipe.id) setSelectedRecipe(updated);
    } catch (err) {
      console.error("Failed to star recipe", err);
    }
  };

  const handleUrlImport = async () => {
    if (!importUrl) return;
    setImporting(true);
    try {
      await importFromUrl(importUrl);
      alert("Recipe imported successfully!");
      setImportUrl(""); 
      loadRecipes();
    } catch (err) {
      console.error(err);
      alert("Failed to import recipe.");
    } finally {
      setImporting(false);
    }
  };

const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    setUploading(true);
    try {
      // 1. Send all photos to AI for extraction
      const aiData = await analyzeImages(files);

      const confirmedTitle = prompt(
        files.length > 1
          ? `Extracted recipe from ${files.length} photos. Title:`
          : "Recipe title found:",
        aiData.title
      );
      if (confirmedTitle) {
        // 2. Build clean recipe object
        const cleanRecipe = {
          title: confirmedTitle,
          ingredients: Array.isArray(aiData.ingredients) ? aiData.ingredients
            : (typeof aiData.ingredients === 'string' ? aiData.ingredients.split('\n') : []),
          structured_ingredients: Array.isArray(aiData.structured_ingredients) ? aiData.structured_ingredients : [],
          instructions: Array.isArray(aiData.instructions) ? aiData.instructions
            : (typeof aiData.instructions === 'string' ? aiData.instructions.split('\n') : []),
          tags: Array.isArray(aiData.tags) ? aiData.tags : [],
          prep_time: aiData.prep_time || null,
          cook_time: aiData.cook_time || null,
          total_time: aiData.total_time || null,
          servings: aiData.servings || null,
          source: {
            type: aiData.source?.type || "personal",
            title: aiData.source?.title || "",
            url: aiData.source?.url || "",
            page: aiData.source?.page || ""
          }
        };

        // 3. Save recipe
        const newRecipe = await createRecipe(cleanRecipe);

        // 4. Determine which photo to save as the recipe image:
        //    - Single photo: always save it.
        //    - Multiple photos: only save if AI identified a dish photo.
        if (newRecipe.id) {
          let imageToSave = null;
          if (files.length === 1) {
            imageToSave = files[0];
          } else if (aiData.dish_photo_index != null && files[aiData.dish_photo_index]) {
            imageToSave = files[aiData.dish_photo_index];
          }
          if (imageToSave) await uploadRecipeImage(newRecipe.id, imageToSave);
        }

        alert("Recipe saved!");
        loadRecipes();
      }
    } catch (err) {
      console.error(err);
      alert("Failed to analyze or save recipe.");
    } finally {
      setUploading(false);
      e.target.value = null;
    }
  };


  const handleDelete = async () => {
    if (!selectedRecipe || !selectedRecipe.id) {
        // If it's a new recipe that hasn't been saved, just clear selection
        setSelectedRecipe(null);
        return;
    }
    const confirm = window.confirm("Are you sure you want to delete this recipe?");
    if (confirm) {
      try {
        await deleteRecipe(selectedRecipe.id);
        alert("Recipe deleted.");
        setSelectedRecipe(null);
        loadRecipes();
      } catch (err) {
        console.error(err);
        alert("Failed to delete recipe.");
      }
    }
  };

  const handleDeleteImage = async () => {
    if (!selectedRecipe) return;

    const confirm = window.confirm("");
    if (confirm("Are you sure you want to delete this recipe?")) {
      try {
        await deleteRecipeImage(selectedRecipe.id);

        const updatedRecipe = { ...selectedRecipe, original_image_url: null };
        setSelectedRecipe(updatedRecipe);

        setRecipes(prevRecipes =>
         prevRecipes.map(r => r.id === selectedRecipe.id ? updatedRecipe : r) 
        );

        alert("Photo removed.");
      } catch (err) {
        console.error("Failed to delete image", err);
        alert("Failed to delete image.");
      }
    }
  };

  const startEditing = () => {
    setEditForm({
      title: selectedRecipe.title,
      tags: safeList(selectedRecipe.tags).join(", "),
      ingredients: safeList(selectedRecipe.ingredients).join("\n"),
      instructions: safeList(selectedRecipe.instructions).join("\n"),
      source_type: selectedRecipe.source?.type || "personal",
      source_title: selectedRecipe.source?.title || "",
      source_url: selectedRecipe.source?.url || "",
      source_page: selectedRecipe.source?.page || "",
      prep_time: selectedRecipe.prep_time || "",
      cook_time: selectedRecipe.cook_time || "",
      total_time: selectedRecipe.total_time || "",
      servings: selectedRecipe.servings || ""
    });
    setIsEditing(true);
  };

  const handleEditChange = (e) => {
    setEditForm({ ...editForm, [e.target.name]: e.target.value });
  };

  // SMART SAVE (Handles both New and Existing)
  const handleSave = async () => {
    try {
      const recipeData = {
        ...selectedRecipe,
        title: editForm.title || "Untitled Recipe",
        tags: editForm.tags.split(",").map(t => t.trim()).filter(t => t !== ""),
        ingredients: editForm.ingredients.split("\n").filter(line => line.trim() !== ""),
        instructions: editForm.instructions.split("\n").filter(line => line.trim() !== ""),
        source: {
            type: editForm.source_type,
            title: editForm.source_title,
            url: editForm.source_url,
            page: editForm.source_page
        },
        prep_time: editForm.prep_time || null,
        cook_time: editForm.cook_time || null,
        total_time: editForm.total_time || null,
        servings: editForm.servings || null
      };

      if (selectedRecipe.id) {
          // UPDATE EXISTING
          await updateRecipe(selectedRecipe.id, recipeData);
      } else {
          // CREATE NEW
          const savedData = await createRecipe(recipeData);
          // Update the selection with the new ID so future saves are updates
          recipeData.id = savedData.id; 
      }
      
      setSelectedRecipe(recipeData);
      setIsEditing(false);
      loadRecipes();
      alert("Recipe saved!");
    } catch (err) {
      console.error(err);
      alert("Failed to save recipe.");
    }
  };

  // --- WAKE LOCK HANDLER ---
  const toggleCookMode = async () => {
    // If it's already ON, turn it OFF
    if (cookMode) {
        if (wakeLock) {
            await wakeLock.release();
            setWakeLock(null);
        }
        setCookMode(false);
        return;
    }

    // If it's OFF, turn it ON
    try {
        if ('wakeLock' in navigator) {
            const lock = await navigator.wakeLock.request('screen');
            setWakeLock(lock);
            setCookMode(true);
            
            // Safety: If user switches tabs, the lock releases automatically.
            // We need to listen for that to update our UI.
            lock.addEventListener('release', () => {
                setCookMode(false);
                setWakeLock(null);
            });
        } else {
            alert("Your browser doesn't support Cook Mode (Wake Lock).");
        }
    } catch (err) {
        console.error(`${err.name}, ${err.message}`);
        alert("Failed to keep screen awake.");
    }
  };

  // Filter Logic
  const filteredRecipes = recipes
    .filter(recipe => {
      const searchTerms = searchTerm.toLowerCase().trim().split(/\s+/);
      const title = (recipe.title || "").toLowerCase();
      const tags = safeList(recipe.tags).map(t => t.toLowerCase());
      const ingredients = safeList(recipe.ingredients).join(" ").toLowerCase();
      return searchTerms.every(term =>
        title.includes(term) ||
        tags.some(tag => tag.includes(term)) ||
        ingredients.includes(term)
      );
    })
    .sort((a, b) => {
      if (a.starred && !b.starred) return -1;
      if (!a.starred && b.starred) return 1;
      return (a.title || "").localeCompare(b.title || "");
    });

  const handleLoginSuccess = (credentialResponse) => {
    // 1. Decode the user info (existing code)
    const decoded = jwtDecode(credentialResponse.credential);
    setUser(decoded);
    
    // 2. Save token to LocalStorage
    localStorage.setItem("token", credentialResponse.credential); 

    // 3. Set token in API
    setAuthToken(credentialResponse.credential);
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem("token"); // Clean up
    setAuthToken(null);
  };


  return (
    <div className="flex flex-col md:flex-row h-screen bg-gray-100 font-sans text-gray-800 overflow-hidden print:h-auto print:overflow-visible">
      {copiedToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-sm px-5 py-2.5 rounded-full shadow-lg z-50">
          Copied to clipboard!
        </div>
      )}

      {showShoppingModal && selectedRecipe && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center p-0 md:p-4" onClick={() => setShowShoppingModal(false)}>
          <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full md:max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xl font-bold">🛒 Shopping List</h3>
              <button onClick={() => setShowShoppingModal(false)} className="text-gray-400 hover:text-gray-600 text-3xl leading-none">&times;</button>
            </div>
            <p className="text-sm text-gray-500 mb-3">{selectedRecipe.title}</p>
            <div className="bg-gray-50 rounded-lg p-4 mb-4 text-sm max-h-56 overflow-y-auto space-y-1">
              {(selectedRecipe.structured_ingredients?.length > 0
                ? selectedRecipe.structured_ingredients.map((ing, i) => {
                    const parts = [ing.qty, ing.unit, ing.item].filter(Boolean);
                    return <div key={i} className="text-gray-700">• {parts.join(" ")}</div>;
                  })
                : safeList(selectedRecipe.ingredients).map((ing, i) => (
                    <div key={i} className="text-gray-700">• {ing}</div>
                  ))
              )}
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <button onClick={handleCopyShoppingList} className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-xl font-bold hover:bg-gray-200 text-sm">📋 Copy</button>
                <button onClick={handleShareShoppingList} className="flex-1 bg-gray-100 text-gray-700 py-2.5 rounded-xl font-bold hover:bg-gray-200 text-sm">📤 Share</button>
              </div>
              <button onClick={handleAddToOurGroceries} disabled={addingToOG} className="w-full bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed">
                {addingToOG ? "Adding…" : "🛍️ Add to Our Groceries"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* --- SIDEBAR --- */}
      <div className={`sidebar w-full md:w-1/3 bg-white border-r border-gray-200 flex flex-col shadow-lg z-10 print:hidden
        ${selectedRecipe ? 'hidden md:flex' : 'flex h-full'}
      `}>
        {/* HEADER: Maximized Image + Login */}
        <div className="bg-yellow-500 shadow-md relative group">
          <img src={headerImage} alt="Recipe Menagerie" className="w-full h-auto object-cover block"  />

        {/* Auth Overlay (Visible on Hover or if Not Logged In) */}
        <div className="absolute top-2 right-2 transition-opacity duration-300 opacity-90 hover:opacity-100">
          {user ? (
            <div className="flex items-center gap-2 bg-white/90 p-1.5 rounded-full shadow-lg pr-3 backdrop-blur-sm">
              <img src={user.picture} alt={user.name} className="w-8 h-8 rounded-full border border-gray-300" />
              <div className="flex flex-col text-xs leading-tight mr-1">
                <span className="font-bold text-gray-800">{user.given_name}</span>
                <button onClick={handleLogout} className="text-red-500 hover:underline text-[10px] text-left font-bold">Sign Out</button>
              </div>
            </div>
           ) : (
          <div className="bg-white p-1 rounded-md shadow-lg">
            <GoogleLogin onSuccess={handleLoginSuccess} onError={() => console.log('Login Failed')} type="icon" shape="circle" />
          </div>
          )}
        </div>
      </div>
        
        {/* ACTION BAR */}
        <div className="p-4 border-b bg-gray-50 space-y-3">
           <input 
             type="text" 
             placeholder="🔍 Search recipes..." 
             value={searchTerm}
             onChange={(e) => setSearchTerm(e.target.value)}
             className="w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-yellow-400"
           />

           {/* ONLY EDITORS CAN ADD */}
           {isEditor && (
           <div className="flex gap-2">
             <input 
                type="text" 
                placeholder="Paste Recipe URL..." 
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                className="flex-1 p-2 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
             />
             <button 
                onClick={handleUrlImport}
                disabled={importing || !importUrl}
                className="bg-blue-600 text-white px-3 py-2 rounded font-bold text-sm hover:bg-blue-700 disabled:bg-gray-300"
             >
                {importing ? "..." : "Import"}
             </button>
           </div>
           )}

           {/* BUTTON ROW: Upload & Manual */}
           {isEditor && (
           <div className="flex gap-2">
               <label className="flex-1 text-center bg-white border-2 border-dashed border-gray-300 rounded-lg p-2 text-sm text-gray-500 hover:border-yellow-500 hover:text-yellow-500 transition cursor-pointer">
                 {uploading ? "⏳..." : "📷 Upload Photo(s)"}
                 <input
                   type="file"
                   className="hidden"
                   accept="image/*"
                   multiple
                   onChange={handleFileUpload}
                   disabled={uploading}
                 />
               </label>
               
               <button 
                 onClick={handleManualEntry}
                 className="flex-1 bg-green-50 border-2 border-dashed border-green-300 text-green-700 rounded-lg p-2 text-sm font-bold hover:bg-green-100 hover:border-green-500 transition"
               >
                 📝 Manual Entry
               </button>
           </div>
           )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
             <p className="text-center text-gray-400 mt-10 animate-pulse">Loading recipes...</p>
          ) : (
            filteredRecipes.map((recipe) => (
              <div
                key={recipe.id}
                onClick={() => selectRecipe(recipe)}
                className={`cursor-pointer p-4 rounded-xl transition-all duration-200 border ${
                  selectedRecipe?.id === recipe.id
                    ? "bg-yellow-50 border-yellow-400 shadow-md transform scale-[1.02]"
                    : "bg-white border-gray-100 hover:bg-gray-50 hover:shadow"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-bold text-lg text-gray-800 leading-tight">{recipe.title || "Untitled Recipe"}</div>
                  <button
                    onClick={(e) => handleStar(recipe, e)}
                    className={`flex-shrink-0 text-xl leading-none mt-0.5 transition-opacity ${isEditor ? "hover:opacity-70 cursor-pointer" : "cursor-default"}`}
                    title={isEditor ? (recipe.starred ? "Unstar recipe" : "Star recipe") : undefined}
                  >
                    {recipe.starred ? "⭐" : <span className="text-gray-200">☆</span>}
                  </button>
                </div>
                <div className="text-xs text-gray-400 uppercase tracking-wide mt-1 flex gap-1 flex-wrap">
                  {safeList(recipe.tags).slice(0, 3).map((tag, i) => (
                    <span key={i} className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-md font-medium">{tag}</span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* --- MAIN CONTENT --- */}
      <div className={`w-full md:flex-1 p-0 md:p-8 overflow-y-auto h-full bg-gray-50 print:p-0 print:h-auto print:overflow-visible print:bg-white
        ${!selectedRecipe ? 'hidden md:flex md:items-center md:justify-center' : 'flex'}
      `}>
        
        {selectedRecipe ? (
          <div className="w-full h-full md:h-auto">
            
            {isEditing ? (
              /* === EDIT MODE === */
            <div className="max-w-3xl mx-auto bg-white p-4 md:p-8 rounded-none md:rounded-lg shadow-lg min-h-screen md:min-h-0">
              <h2 className="text-2xl font-bold mb-6 text-gray-800 border-b pb-2">
                {selectedRecipe.id ? "Edit Recipe" : "New Recipe"}
              </h2>

             {/* --- PHOTO MANAGER --- */}
             <div className="mb-8 p-6 bg-gray-50 rounded-xl border-2 border-dashed border-gray-300 text-center relative">
               <label className="block font-bold mb-2 text-gray-400 uppercase tracking-wide text-xs">Recipe Photo</label>
               {selectedRecipe.original_image_url ? (<div className="relative inline-block group">
                <img src={selectedRecipe.original_image_url} alt="Recipe" className="h-64 w-auto object-cover rounded-lg shadow-md mx-auto" />
              {/* DELETE BUTTON */}
              <button 
                  onClick={handleDeleteImage}
                  className="text-red-500 text-xs underline mt-2 hover:text-red-700">
                  🗑️
              </button>
          </div>
      ) : (
          <div className="flex flex-col items-center justify-center py-4">
              <div className="text-gray-300 text-5xl mb-3">📷</div>
              {selectedRecipe.id ? (
                  <label className="cursor-pointer bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-full shadow-sm hover:bg-blue-50 hover:border-blue-400 transition font-medium">
                      Upload Photo
                      <input 
                          type="file" 
                          className="hidden" 
                          accept="image/*"
                          onChange={async (e) => {
                              if (e.target.files[0]) {
                                if (confirm(`Create recipe: ${aiData.title}?`)) {
                                  try {
                                    // 1. PREPARE CLEAN JSON (BULLETPROOF VERSION)
                                    const cleanRecipe = {
                                      title: confirmedTitle,

                                      // Safety Check: If AI gives a string/null, convert to empty array or split by newlines
                                      ingredients: Array.isArray(aiData.ingredients) 
                                      ? aiData.ingredients 
                                      : (typeof aiData.ingredients === 'string' ? aiData.ingredients.split('\n') : []),

                                      instructions: Array.isArray(aiData.instructions) 
                                      ? aiData.instructions 
                                      : (typeof aiData.instructions === 'string' ? aiData.instructions.split('\n') : []),

                                      tags: Array.isArray(aiData.tags) ? aiData.tags : [],

                                      // Safety Check: Ensure 'source' has the required 'type' field
                                      source: {
                                        type: aiData.source?.type || "n/a", // Default to "personal" if missing
                                        title: aiData.source?.title || "",
                                        url: aiData.source?.url || "",
                                        page: aiData.source?.page || ""
                                      }
                                    };
                                    // 2. CALL DIRECTLY
                                    const newRecipe = await createRecipe(cleanRecipe);

                                    // 3. UPDATE UI
                                    setRecipes([...recipes, newRecipe]);
                                    alert("Recipe created!");
                                  } catch (err) {
                                    console.error(err);
                                    alert("Failed to create recipe.");
                                  }
                                }
                              }
                          }}
                      />
                  </label>
              ) : (
                  <p className="text-sm text-gray-400 italic">Save the recipe first to add a photo.</p>
              )}
          </div>
      )}
  </div>

                {/* --- TITLE INPUT --- */}
                <div className="mb-6">
                  <label className="block font-bold mb-2 text-gray-600">Title</label>
                  <input name="title" value={editForm.title} onChange={handleEditChange} className="w-full text-xl p-3 border border-gray-300 rounded outline-none focus:border-yellow-400" placeholder="Recipe Name" />
                </div>

                <div className="mb-6 print:hidden">
                  <label className="block font-bold mb-2 text-gray-600">Tags (comma separated)</label>
                  <input
                    name="tags"
                    value={editForm.tags}
                    onChange={handleEditChange}
                    placeholder="e.g. Dinner, Spicy, Italian"
                    className="w-full p-3 border border-gray-300 rounded outline-none focus:border-yellow-400"
                  />
                </div>

                <div className="mb-6 bg-gray-50 p-4 rounded border border-gray-200">
                  <h3 className="font-bold text-gray-700 mb-3">Times &amp; Servings</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-500 mb-1">Prep Time</label>
                      <input name="prep_time" value={editForm.prep_time} onChange={handleEditChange} placeholder="20 mins" className="w-full p-2 border rounded outline-none focus:border-yellow-400" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-500 mb-1">Cook Time</label>
                      <input name="cook_time" value={editForm.cook_time} onChange={handleEditChange} placeholder="45 mins" className="w-full p-2 border rounded outline-none focus:border-yellow-400" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-500 mb-1">Total Time</label>
                      <input name="total_time" value={editForm.total_time} onChange={handleEditChange} placeholder="1 hr 5 mins" className="w-full p-2 border rounded outline-none focus:border-yellow-400" />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-500 mb-1">Servings</label>
                      <input name="servings" value={editForm.servings} onChange={handleEditChange} placeholder="4" className="w-full p-2 border rounded outline-none focus:border-yellow-400" />
                    </div>
                  </div>
                </div>

                <div className="mb-6 bg-gray-50 p-4 rounded border border-gray-200">
                    <h3 className="font-bold text-gray-700 mb-3">Source Information</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-gray-500 mb-1">Type</label>
                            <select name="source_type" value={editForm.source_type} onChange={handleEditChange} className="w-full p-2 border rounded">
                                <option value="personal">Personal / Family</option>
                                <option value="book">Cookbook</option>
                                <option value="website">Website</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-500 mb-1">Source Name</label>
                            <input name="source_title" value={editForm.source_title} onChange={handleEditChange} className="w-full p-2 border rounded" />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-500 mb-1">Page Number</label>
                            <input name="source_page" value={editForm.source_page} onChange={handleEditChange} className="w-full p-2 border rounded" />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-gray-500 mb-1">URL</label>
                            <input name="source_url" value={editForm.source_url} onChange={handleEditChange} className="w-full p-2 border rounded" />
                        </div>
                    </div>
                </div>

                <div className="mb-6">
                  <label className="block font-bold mb-2 text-gray-600">Ingredients</label>
                  <textarea name="ingredients" value={editForm.ingredients} onChange={handleEditChange} className="w-full h-48 p-3 border border-gray-300 rounded font-mono text-sm outline-none focus:border-yellow-400" placeholder="1 cup flour..." />
                </div>

                <div className="mb-8">
                  <label className="block font-bold mb-2 text-gray-600">Instructions</label>
                  <textarea name="instructions" value={editForm.instructions} onChange={handleEditChange} className="w-full h-48 p-3 border border-gray-300 rounded font-mono text-sm outline-none focus:border-yellow-400" placeholder="1. Mix ingredients..." />
                </div>

                <div className="flex gap-4 pt-4 border-t pb-10">
                  <button onClick={handleSave} className="bg-green-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-green-700 shadow">
                      {selectedRecipe.id ? "Save Changes" : "Create Recipe"}
                  </button>
                  <button onClick={() => {
                      if (!selectedRecipe.id) { goBack(); } else { setIsEditing(false); }
                  }} className="bg-gray-400 text-white px-6 py-2 rounded-lg font-bold hover:bg-gray-500">Cancel</button>
                </div>
              </div>

            ) : (
              /* === VIEW MODE === */
              <div className="max-w-4xl mx-auto bg-white p-6 md:p-10 rounded-none md:rounded-2xl shadow-none md:shadow-xl min-h-screen md:min-h-0">
                <button onClick={goBack} className="mb-6 text-gray-500 hover:text-gray-700 font-medium flex items-center gap-2 print:hidden">
                   ← Back to List
                </button>

                {selectedRecipe.original_image_url && (
                  <img src={selectedRecipe.original_image_url} alt={selectedRecipe.title} className="w-full h-64 md:h-80 object-cover rounded-xl mb-6 shadow-sm" />
                )}

                {/* TITLE HEADER + COOK MODE */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-3 border-b pb-4">
                  <div className="flex items-center gap-3">
                    <h1 className="text-3xl md:text-4xl font-extrabold text-gray-900 leading-tight">
                      {selectedRecipe.title || "Untitled Recipe"}
                    </h1>
                    <button
                      onClick={(e) => handleStar(selectedRecipe, e)}
                      className={`text-2xl leading-none flex-shrink-0 transition-opacity ${isEditor ? "hover:opacity-70 cursor-pointer" : "cursor-default"} print:hidden`}
                      title={isEditor ? (selectedRecipe.starred ? "Unstar recipe" : "Star recipe") : undefined}
                    >
                      {selectedRecipe.starred ? "⭐" : <span className="text-gray-200">☆</span>}
                    </button>
                  </div>

                  <button onClick={toggleCookMode}
                    className={`flex items-center gap-2 px-4 py-2 rounded-full font-bold text-sm shadow-sm transition-all print:hidden
                      ${cookMode ? "bg-green-100 text-green-800 ring-2 ring-green-500 animate-pulse"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                      }
                    `}>
                    {cookMode ? "🔥 Cook Mode ON" : "💤 Cook Mode OFF"}
                  </button>
                </div>

                {/* TIMES + SERVINGS ROW */}
                {(selectedRecipe.prep_time || selectedRecipe.cook_time || selectedRecipe.total_time || selectedRecipe.servings) && (() => {
                  const base = parseBaseServings(selectedRecipe.servings);
                  const effective = targetServings ?? base;
                  const factor = base && effective ? effective / base : 1;
                  return (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-5 text-sm text-gray-500">
                      {selectedRecipe.prep_time && <span>⏱ Prep: <strong className="text-gray-700">{selectedRecipe.prep_time}</strong></span>}
                      {selectedRecipe.cook_time && <span>🍳 Cook: <strong className="text-gray-700">{selectedRecipe.cook_time}</strong></span>}
                      {selectedRecipe.total_time && <span>⏰ Total: <strong className="text-gray-700">{selectedRecipe.total_time}</strong></span>}
                      {base ? (
                        <span className="flex items-center gap-1">
                          🍽 Serves:
                          <button onClick={() => setTargetServings(Math.max(1, (effective ?? base) - 1))} className="w-5 h-5 rounded-full bg-gray-200 hover:bg-gray-300 font-bold text-xs leading-none flex items-center justify-center print:hidden">−</button>
                          <strong className="text-gray-700 w-5 text-center">{effective}</strong>
                          <button onClick={() => setTargetServings((effective ?? base) + 1)} className="w-5 h-5 rounded-full bg-gray-200 hover:bg-gray-300 font-bold text-xs leading-none flex items-center justify-center print:hidden">+</button>
                          {factor !== 1 && <span className="text-xs text-yellow-600 font-semibold print:hidden">({factor.toFixed(2)}×)</span>}
                        </span>
                      ) : selectedRecipe.servings ? (
                        <span>🍽 Serves: <strong className="text-gray-700">{selectedRecipe.servings}</strong></span>
                      ) : null}
                    </div>
                  );
                })()}
                
                {/* SAFE TAGS */}
                {safeList(selectedRecipe.tags).length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-6 print:hidden">
                    {safeList(selectedRecipe.tags).map((tag, i) => (
                      <span key={i} className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-sm font-semibold shadow-sm">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Source Info */}
                {selectedRecipe.source && (selectedRecipe.source.title || selectedRecipe.source.url) && (
                    <div className="text-gray-500 mb-8 italic flex flex-wrap items-center gap-2 border-l-4 border-gray-300 pl-4">
                        <span className="font-semibold">Source:</span>
                        {selectedRecipe.source.url ? (
                            <a href={selectedRecipe.source.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                                {selectedRecipe.source.title || "Website Link"}
                            </a>
                        ) : (
                            <span>{selectedRecipe.source.title || "Unknown"}</span>
                        )}
                        {selectedRecipe.source.page && (
                            <span className="bg-gray-100 px-2 py-0.5 rounded text-sm not-italic">Page {selectedRecipe.source.page}</span>
                        )}
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 mt-6">
                  <div>
                    <h3 className="text-2xl font-bold mb-4 text-gray-800 border-b-4 border-yellow-300 pb-1 inline-block">Ingredients</h3>
                    <ul className="space-y-3 text-gray-700 leading-relaxed">
                      {(() => {
                        const base = parseBaseServings(selectedRecipe.servings);
                        const effective = targetServings ?? base;
                        const factor = base && effective ? effective / base : 1;
                        const scaled = selectedRecipe.structured_ingredients?.length > 0 && factor !== 1;
                        if (scaled) {
                          return selectedRecipe.structured_ingredients.map((ing, i) => {
                            const qty = scaleQty(ing.qty, factor);
                            const parts = [qty, ing.unit, ing.item].filter(Boolean);
                            return <li key={i} className="flex items-start"><span className="mr-3 text-yellow-500 mt-1.5 text-xs">●</span>{parts.join(" ")}</li>;
                          });
                        }
                        return safeList(selectedRecipe.ingredients).map((ing, i) => (
                          <li key={i} className="flex items-start"><span className="mr-3 text-yellow-500 mt-1.5 text-xs">●</span> {ing}</li>
                        ));
                      })()}
                    </ul>
                  </div>
                  <div>
                    <h3 className="text-2xl font-bold mb-4 text-gray-800 border-b-4 border-blue-300 pb-1 inline-block">Instructions</h3>
                    <ol className="space-y-5 text-gray-700">
                      {safeList(selectedRecipe.instructions).map((step, i) => (
                        <li key={i} className="flex gap-4"><span className="font-bold text-gray-300 text-2xl -mt-1">{i + 1}</span><span className="leading-relaxed mt-1">{step}</span></li>
                      ))}
                    </ol>
                  </div>
                </div>

                <div className="mt-12 pt-8 border-t border-gray-100 flex flex-col md:flex-row gap-4 pb-10 print:hidden">
                  {isEditor && (<>
                    <button onClick={() => setShowShoppingModal(true)} className="bg-yellow-500 text-white px-5 py-3 rounded-lg font-bold hover:bg-yellow-600 shadow-md flex items-center justify-center gap-2">🛒 Shopping List</button>
                    <button onClick={startEditing} className="bg-blue-600 text-white px-8 py-3 rounded-lg font-bold hover:bg-blue-700 shadow-md flex items-center justify-center gap-2">✏️ Edit</button>
                    <button onClick={handleDelete} className="bg-red-50 text-red-600 border border-red-200 px-6 py-3 rounded-lg font-bold hover:bg-red-100 flex items-center justify-center gap-2">🗑️ Delete</button>
                  </>)}
                  <button onClick={handleShare} className="bg-gray-100 text-gray-600 border border-gray-200 px-6 py-3 rounded-lg font-bold hover:bg-gray-200 flex items-center justify-center gap-2 print:hidden">🔗 Share</button>
                  <button onClick={() => window.print()} className="bg-gray-100 text-gray-600 border border-gray-200 px-6 py-3 rounded-lg font-bold hover:bg-gray-200 flex items-center justify-center gap-2 print:hidden">🖨️ Print</button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* --- NO RECIPE SELECTED --- */
          <div className="text-center text-gray-400">
             <div className="text-6xl mb-4">{randomEmoji}</div>
             <p className="text-2xl font-light">Let's cook something good!</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
